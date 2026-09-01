#!/usr/bin/env node
// auralwatermark CLI — gen / embed / detect.
//
//   auralwatermark gen    out.wav --seconds 30 [--rate 44100] [--channels 1] [--bits 16]
//   auralwatermark embed  in.wav out.wav --id 1234567 [--key secret] [--strength 0.5]
//                         [--band low:high]
//   auralwatermark detect in.wav [--id 1234567] [--key secret] [--band low:high]
//                         [--json]
//
// Exit codes: 0 ok (and detected, for `detect`), 1 not detected / usage of
// detect without match, 2 hard error (bad file, bad args).

import { argv, exit } from "node:process";
import { readWavFile, writeWavFile } from "../src/wav.js";
import { synthesizeSpeechLike } from "../src/synth.js";
import { embedWatermark } from "../src/embed.js";
import { detectWatermark } from "../src/detect.js";
import { DEFAULT_BAND } from "../src/signal.js";

const HELP = `auralwatermark v0.2.0 — inaudible provenance watermark for human-made audio

Usage:
  auralwatermark gen out.wav --seconds 30 [--rate 44100] [--channels 1] [--bits 16]
      Generate synthetic speech-like audio for demos/tests.

  auralwatermark embed in.wav out.wav --id <uint32> [--key secret]
      [--strength 0..1] [--band high|mid|dual|lowHz:highHz]
      Embed watermark carrying the payload id (default band: dual — the
      payload goes into BOTH 16.5-19.5 kHz and 8-13 kHz for codec survival).

  auralwatermark detect in.wav [--id <uint32>] [--key secret]
      [--band auto|high|mid|dual|lowHz:highHz] [--json]
      Verify an expected id (matched filter) or run blind detection + CRC
      decode when --id is omitted. Default --band auto tries high+mid and
      keeps the best-scoring result.

Exit codes: 0 success/detected · 1 not detected · 2 error`;

function parseArgs(rest) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--help" || a === "-h") flags.help = true;
    else if (a === "--json") flags.json = true;
    else if (a.startsWith("--")) {
      const name = a.slice(2);
      const val = i + 1 < rest.length && !rest[i + 1].startsWith("--") ? rest[++i] : true;
      flags[name] = val;
    } else pos.push(a);
  }
  return { pos, flags };
}

function num(flags, name, dflt) {
  const v = flags[name];
  if (v === undefined) return dflt;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`--${name} expects a number, got '${v}'`);
  return n;
}

function bandOf(flags, dflt) {
  const v = flags.band;
  if (v === undefined || v === true) return dflt;
  const s = String(v);
  if (["high", "mid", "dual", "auto"].includes(s.toLowerCase())) return s.toLowerCase();
  const m = s.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  if (!m) throw new Error("--band expects high|mid|dual|auto or lowHz:highHz");
  return { lowHz: Number(m[1]), highHz: Number(m[2]) };
}

function die(msg, code = 2) {
  console.error("error:", msg);
  console.error(HELP);
  exit(code);
}

async function main() {
  const [cmd, ...rest] = argv.slice(2);
  const { pos, flags } = parseArgs(rest);

  if (!cmd || cmd === "help" || flags.help) {
    console.log(HELP);
    exit(cmd ? 0 : 2);
  }

  if (cmd === "gen") {
    const out = pos[0];
    if (!out) die("gen requires an output .wav path");
    const seconds = num(flags, "seconds", 10);
    const rate = Math.round(num(flags, "rate", 44100));
    const channels = Math.round(num(flags, "channels", 1));
    const bits = [16, 24].includes(num(flags, "bits", 16)) ? num(flags, "bits", 16) : 16;
    const t0 = Date.now();
    const pcm = synthesizeSpeechLike({ seconds, sampleRate: rate, channels });
    await writeWavFile(out, pcm, { sampleRate: rate, channels, bitDepth: bits });
    console.log(
      `gen: wrote ${out} — ${seconds}s speech-like tone, ${rate} Hz, ${channels}ch, ${bits}-bit PCM (${(
        (Date.now() - t0) / 1000
      ).toFixed(2)}s)`
    );
    exit(0);
  }

  if (cmd === "embed") {
    const [inp, outp] = pos;
    if (!inp || !outp) die("embed requires input.wav output.wav");
    if (flags.id === undefined) die("embed requires --id <uint32>");
    const id = Number(flags.id);
    if (!Number.isInteger(id) || id < 0 || id > 0xffffffff) die(`--id must be a uint32, got '${flags.id}'`);
    const strength = num(flags, "strength", 0.5);
    const key = typeof flags.key === "string" ? flags.key : "aural-watermark-default-key";

    const t0 = Date.now();
    const wav = await readWavFile(inp);
    const watermarked = embedWatermark(wav.samples, { sampleRate: wav.sampleRate, channels: wav.channels }, {
      payloadId: id,
      key,
      strength,
      band: bandOf(flags, "dual"),
    });
    await writeWavFile(outp, watermarked, {
      sampleRate: wav.sampleRate,
      channels: wav.channels,
      bitDepth: wav.bitsPerSample === 24 ? 24 : 16,
    });
    const meta = watermarked.watermarkMeta;
    const bandLabel =
      meta.band === "dual"
        ? "dual (high 16.5-19.5 kHz + mid 8-13 kHz)"
        : `${Math.round(meta.band.lowHz)}-${Math.round(meta.band.highHz)} Hz`;
    console.log(
      `embed: id=${meta.payloadId} key='${key}' strength=${meta.strength} -> ${outp}\n` +
        `  band ${bandLabel}, peak watermark ${(20 * Math.log10(meta.peakWatermark)).toFixed(1)} dBFS, ${meta.geometry.reps} repetition(s), ${(
          (Date.now() - t0) / 1000
        ).toFixed(2)}s`
    );
    exit(0);
  }

  if (cmd === "detect") {
    const inp = pos[0];
    if (!inp) die("detect requires input.wav");
    const key = typeof flags.key === "string" ? flags.key : "aural-watermark-default-key";
    let expectedId;
    if (flags.id !== undefined) {
      expectedId = Number(flags.id);
      if (!Number.isInteger(expectedId) || expectedId < 0 || expectedId > 0xffffffff) {
        die(`--id must be a uint32, got '${flags.id}'`);
      }
    }
    const t0 = Date.now();
    const wav = await readWavFile(inp);
    const res = detectWatermark(wav.samples, { sampleRate: wav.sampleRate, channels: wav.channels }, {
      key,
      payloadId: expectedId,
      band: bandOf(flags, "auto"),
    });
    const ms = Date.now() - t0;

    if (flags.json) {
      console.log(JSON.stringify({ file: inp, format: wav.format, durationSec: wav.durationSec, ...res }, null, 2));
    } else {
      console.log(`detect: ${inp}`);
      console.log(
        `  file:     ${wav.format}, ${wav.sampleRate} Hz, ${wav.channels}ch, ${wav.durationSec.toFixed(1)}s`
      );
      console.log(`  mode:     ${res.details.mode}${expectedId !== undefined ? ` (expect id=${expectedId})` : ""}`);
      console.log(`  detected: ${res.detected ? "YES" : "NO"}`);
      console.log(`  confidence: ${res.confidence.toFixed(3)}`);
      console.log(
        `  band hit: ${res.details.bandUsed ? `${Math.round(res.details.bandUsed.lowHz)}-${Math.round(res.details.bandUsed.highHz)} Hz` : "-"} (${res.details.bandsTried} tried)`
      );
      console.log(`  ber:      ${(res.ber * 100).toFixed(1)}% (${Math.round(res.ber * res.details.bits)}/${res.details.bits} bits)`);
      console.log(`  recovered id: ${res.recoveredPayloadId ?? "none"}`);
      if (res.details.singleBitCorrected !== null) {
        console.log(`  note:     single-bit error corrected at position ${res.details.singleBitCorrected}`);
      }
      console.log(`  time:     ${ms} ms`);
    }
    exit(res.detected ? 0 : 1);
  }

  die(`unknown command '${cmd}'`);
}

main().catch((err) => {
  console.error("error:", err.message);
  exit(2);
});
