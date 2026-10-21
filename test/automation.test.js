// End-to-end automation: batch distribution manifest -> forensic leak audit.
// Exercises the two operator-facing scripts exactly the way a label would.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { writeWavFile, parseWav } from "../src/wav.js";
import { synthesizeSpeechLike } from "../src/synth.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BATCH = join(ROOT, "scripts", "batch_distribute.js");
const AUDIT = join(ROOT, "scripts", "audit_leak.js");
const RECIPIENTS = ["Alice Example", "Bob Example", "Carol Example"];
const START_ID = 200001;

const workDir = fs.mkdtempSync(join(os.tmpdir(), "aureal-e2e-"));
const masterPath = join(workDir, "master.wav");
const promoDir = join(workDir, "promos");
const manifestPath = join(promoDir, "recipients.json");
let manifest = null;

function run(script, args, options = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    cwd: ROOT,
    timeout: 180000,
    ...options
  });
}

function hasFfmpeg() {
  const probe = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" });
  return probe.status === 0;
}

test.before(() => {
  const samples = synthesizeSpeechLike({ seconds: 6, sampleRate: 48000, channels: 2, seed: "e2e", peak: 0.4 });
  return writeWavFile(masterPath, samples, { sampleRate: 48000, channels: 2, bitDepth: 24 });
});

test("batch_distribute tags every recipient and writes a verifiable manifest", () => {
  const result = run(BATCH, [
    masterPath,
    "--recipients", RECIPIENTS.join(","),
    "--out-dir", promoDir,
    "--start-id", String(START_ID),
    "--band", "dual",
    "--strength", "0.6"
  ]);
  assert.equal(result.status, 0, `batch_distribute failed:\n${result.stdout}\n${result.stderr}`);

  assert.ok(fs.existsSync(manifestPath), "recipients.json must exist");
  manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

  assert.equal(manifest.masterFile, "master.wav");
  assert.equal(manifest.band, "dual");
  assert.equal(manifest.strength, 0.6);
  assert.equal(manifest.startId, START_ID);
  assert.equal(manifest.masterBitDepth, 24);
  assert.equal(manifest.recipients.length, RECIPIENTS.length);
  assert.deepEqual(manifest.recipients.map((r) => r.name), RECIPIENTS);
  assert.deepEqual(manifest.recipients.map((r) => r.id), [START_ID, START_ID + 1, START_ID + 2]);

  assert.ok(manifest.tardos, "manifest must carry the Tardos codebook");
  assert.equal(manifest.tardos.codeLength, 48);
  assert.equal(manifest.tardos.biases.length, 48);
  assert.ok(manifest.tardos.cutoff > 0 && manifest.tardos.cutoff < 0.5);

  for (const recipient of manifest.recipients) {
    const filePath = join(promoDir, recipient.filename);
    assert.ok(fs.existsSync(filePath), `missing promo ${recipient.filename}`);
    const bytes = fs.readFileSync(filePath);
    assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"), recipient.sha256,
      "manifest sha256 must match the delivered file");
    const parsed = parseWav(bytes);
    assert.equal(parsed.bitsPerSample, 24, "promo must preserve the 24-bit master depth");
    assert.equal(parsed.channels, 2);
    assert.equal(parsed.sampleRate, 48000);
    assert.equal(recipient.tardosCodeword.length, 48);
    assert.ok(recipient.tardosCodeword.every((v) => v === 1 || v === -1));
  }
});

test("audit_leak traces a leaked WAV back to the exact recipient", () => {
  const leaked = join(promoDir, manifest.recipients[1].filename);
  const result = run(AUDIT, [leaked, "--manifest", manifestPath]);
  assert.equal(result.status, 0, `audit_leak failed:\n${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /WATERMARK VERIFIED/);
  assert.match(result.stdout, new RegExp(`Recovered ID:\\s+#${START_ID + 1}`));
  assert.match(result.stdout, /Recipient Name:\s+Bob Example/);
  assert.match(result.stdout, /VERDICT: Leak traced directly to "Bob Example"/);
});

test("audit_leak --json emits a machine-readable leak verdict", () => {
  const leaked = join(promoDir, manifest.recipients[2].filename);
  const result = run(AUDIT, [leaked, "--manifest", manifestPath, "--json"]);
  assert.equal(result.status, 0, `audit_leak --json failed:\n${result.stdout}\n${result.stderr}`);
  const report = JSON.parse(result.stdout);
  assert.equal(report.detection.detected, true);
  assert.equal(report.detection.recoveredPayloadId, START_ID + 2);
  assert.equal(report.leakMatch.name, "Carol Example");
  assert.match(report.verdict, /Carol Example/);
  assert.ok(Array.isArray(report.detection.details.softSymbols));
});

test("audit_leak identifies a recipient after an MP3 transcode", { skip: !hasFfmpeg() && "ffmpeg not installed" }, () => {
  const source = join(promoDir, manifest.recipients[0].filename);
  const leakedMp3 = join(workDir, "leaked.mp3");
  const encode = spawnSync("ffmpeg", ["-v", "error", "-y", "-i", source, "-b:a", "192k", leakedMp3], { encoding: "utf8" });
  assert.equal(encode.status, 0, `ffmpeg encode failed:\n${encode.stderr}`);

  const result = run(AUDIT, [leakedMp3, "--manifest", manifestPath]);
  assert.equal(result.status, 0, `audit_leak on MP3 failed:\n${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /Recipient Name:\s+Alice Example/);
  assert.match(result.stdout, new RegExp(`Recovered ID:\\s+#${START_ID}`));
});

test("audit_leak reports no watermark for a clean master and exits non-zero", () => {
  const result = run(AUDIT, [masterPath, "--manifest", manifestPath]);
  assert.equal(result.status, 1, "clean audio audit must exit 1");
  assert.match(result.stdout, /NO WATERMARK DETECTED/);
});

test("batch_distribute rejects invalid operator input", () => {
  const cases = [
    [["--start-id", "not-a-number"], /--start-id must be an integer/],
    [["--strength", "2"], /--strength must be a number between 0.01 and 1\.0/],
    [["--band", "ultrasonic"], /--band must be/]
  ];

  for (const [extraArgs, pattern] of cases) {
    const result = run(BATCH, [
      masterPath,
      "--recipients", "Solo",
      "--out-dir", join(workDir, "never-written"),
      ...extraArgs
    ]);
    assert.equal(result.status, 1, `expected failure for ${extraArgs.join(" ")}`);
    assert.match(`${result.stdout}\n${result.stderr}`, pattern);
  }
});

test("batch_distribute rejects an ID range that overflows the 32-bit space", () => {
  const result = run(BATCH, [
    masterPath,
    "--recipients", "Solo A,Solo B",
    "--out-dir", join(workDir, "never-written"),
    "--start-id", "4294967295"
  ]);
  assert.equal(result.status, 1);
  assert.match(`${result.stdout}\n${result.stderr}`, /exceeds the 32-bit ID space/);
});

test.after(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});
