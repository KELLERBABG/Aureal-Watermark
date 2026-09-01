"use strict";

// codec.test.js — REAL lossy-codec survival tests via ffmpeg.
// Pipeline: synthesize → embed (per band spec) → ffmpeg encode (mp3/aac)
//           → decode back to WAV → detect. Skipped entirely when ffmpeg
//           or the needed encoder is missing.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readWavFile, writeWavFile } from "../src/wav.js";
import { synthesizeSpeechLike } from "../src/synth.js";
import { embedWatermark } from "../src/embed.js";
import { detectWatermark } from "../src/detect.js";

let dir;
const ID = 1234567;
const KEY = "codec-test-key";
const SECONDS = 20;
const RATE = 44100;

function haveFfmpeg() {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function encoderAvailable(name) {
  try {
    const out = execFileSync("ffmpeg", ["-hide_banner", "-encoders"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.includes(name);
  } catch {
    return false;
  }
}

function transcode(srcWav, dstWav, codecArgs) {
  execFileSync(
    "ffmpeg",
    ["-hide_banner", "-loglevel", "error", "-y", "-i", srcWav, ...codecArgs, dstWav],
    { stdio: ["ignore", "pipe", "pipe"] }
  );
}

async function makeWatermarked(bandSpec) {
  const pcm = synthesizeSpeechLike({ seconds: SECONDS, sampleRate: RATE, channels: 1 });
  const wm = embedWatermark(pcm, { sampleRate: RATE, channels: 1 }, {
    payloadId: ID,
    key: KEY,
    strength: 0.5,
    band: bandSpec,
  });
  const path = join(dir, `wm-${String(bandSpec).replace(/[^a-z]/g, "")}.wav`);
  await writeWavFile(path, wm, { sampleRate: RATE, channels: 1, bitDepth: 16 });
  return path;
}

async function detect(path, bandSpec = "auto") {
  const wav = await readWavFile(path);
  return detectWatermark(wav.samples, { sampleRate: wav.sampleRate, channels: wav.channels }, {
    key: KEY,
    payloadId: ID,
    band: bandSpec,
  });
}

if (!haveFfmpeg()) {
  test("ffmpeg not available – codec tests skipped", { skip: true }, () => {});
} else {
  const hasMp3 = encoderAvailable("libmp3lame");
  const hasAac = encoderAvailable("aac");

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "auralwatermark-codec-"));
  });

  after(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  for (const band of ["high", "mid", "dual"]) {
    if (hasMp3) {
      for (const kbps of [128, 320]) {
        test(`MP3 ${kbps}k round-trip survives with --band ${band}`, async () => {
          const src = await makeWatermarked(band);
          const mp3 = join(dir, `${band}-${kbps}.mp3`);
          transcode(src, mp3, ["-c:a", "libmp3lame", "-b:a", `${kbps}k`]);
          const back = join(dir, `${band}-${kbps}-back.wav`);
          transcode(mp3, back, ["-c:a", "pcm_s16le"]);
          const r = await detect(back);
          assert.equal(r.detected, true,
            `band=${band} mp3=${kbps}k: confidence=${r.confidence.toFixed(2)} ber=${r.ber.toFixed(2)}`);
          assert.ok(r.confidence >= 0.5);
        }, { timeout: 120_000 });
      }
    }

    if (hasAac) {
      test(`AAC 128k round-trip survives with --band ${band}`, async () => {
        const src = await makeWatermarked(band);
        const m4a = join(dir, `${band}-aac.m4a`);
        transcode(src, m4a, ["-c:a", "aac", "-b:a", "128k"]);
        const back = join(dir, `${band}-aac-back.wav`);
        transcode(m4a, back, ["-c:a", "pcm_s16le"]);
        const r = await detect(back);
        assert.equal(r.detected, true,
          `band=${band} aac128: confidence=${r.confidence.toFixed(2)} ber=${r.ber.toFixed(2)}`);
      }, { timeout: 120_000 });
    }
  }

  if (hasMp3) {
    test("auto detection reports which band hit after MP3 128k (dual embed)", async () => {
      const src = await makeWatermarked("dual");
      const mp3 = join(dir, "dual-auto.mp3");
      transcode(src, mp3, ["-c:a", "libmp3lame", "-b:a", "128k"]);
      const back = join(dir, "dual-auto-back.wav");
      transcode(mp3, back, ["-c:a", "pcm_s16le"]);
      const r = await detect(back, "auto");
      assert.equal(r.detected, true);
      assert.equal(r.recoveredPayloadId, ID);
      assert.equal(r.details.bandsTried, 2);
      assert.ok(r.details.bandUsed, "expected a bandUsed report");
    }, { timeout: 120_000 });

    test("wrong id rejected after MP3 round-trip", async () => {
      const src = await makeWatermarked("dual");
      const mp3 = join(dir, "wrong-id.mp3");
      transcode(src, mp3, ["-c:a", "libmp3lame", "-b:a", "128k"]);
      const back = join(dir, "wrong-id-back.wav");
      transcode(mp3, back, ["-c:a", "pcm_s16le"]);
      const wav = await readWavFile(back);
      const r = detectWatermark(wav.samples, { sampleRate: wav.sampleRate, channels: wav.channels }, {
        key: KEY,
        payloadId: (ID ^ 0x5555) >>> 0,
        band: "auto",
      });
      assert.equal(r.detected, false);
    }, { timeout: 120_000 });
  }
}
