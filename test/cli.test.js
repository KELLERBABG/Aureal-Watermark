// test/cli.test.js — end-to-end CLI smoke test: gen -> embed -> detect.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, statSync, readFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { readWavFile, writeWavFile } from "../src/wav.js";
import { synthesizeSpeechLike } from "../src/synth.js";

const cli = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "auralwatermark.js");
const work = mkdtempSync(join(tmpdir(), "aw-cli-"));

function run(args, options = {}) {
  const r = spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    ...options
  });
  return {
    status: r.status,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
  };
}

test.after(() => {
  try {
    rmSync(work, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

test("gen creates a wav file", () => {
  const out = join(work, "tone.wav");
  const r = run(["gen", out, "--seconds", "6", "--rate", "48000"]);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(out));
  // 6s * 48000 * 2 bytes + header
  assert.equal(statSync(out).size, 44 + 6 * 48000 * 2);
});

test("embed writes watermarked copy of same size", () => {
  const inp = join(work, "tone.wav");
  const out = join(work, "marked.wav");
  const r = run(["embed", inp, out, "--id", "8675309", "--key", "demo-secret"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /id=8675309/);
  assert.ok(existsSync(out));
  assert.equal(statSync(out).size, statSync(inp).size);
});

test("detect with correct id exits 0 and reports YES", () => {
  const r = run(["detect", join(work, "marked.wav"), "--id", "8675309", "--key", "demo-secret"]);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.match(r.stdout, /detected:\s*YES/);
  assert.match(r.stdout, /ber:\s*0\.0%/);
});

test("detect with wrong id exits 1 and reports NO (rejection works)", () => {
  const r = run(["detect", join(work, "marked.wav"), "--id", "1111111", "--key", "demo-secret"]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /detected:\s*NO/);
});

test("blind detect (no --id) recovers the embedded id via CRC", () => {
  const r = run(["detect", join(work, "marked.wav"), "--key", "demo-secret"]);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.match(r.stdout, /detected:\s*YES/);
  assert.match(r.stdout, /recovered id:\s*8675309/);
});

test("detect with wrong key exits 1", () => {
  const r = run(["detect", join(work, "marked.wav"), "--id", "8675309", "--key", "wrong-key"]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /detected:\s*NO/);
});

test("unwatermarked file is not detected", () => {
  const r = run(["detect", join(work, "tone.wav"), "--id", "8675309", "--key", "demo-secret"]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /detected:\s*NO/);
});

test("CLI embeds to and detects from MP3 when ffmpeg is available", (t) => {
  const check = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" });
  if (check.error || check.status !== 0) {
    t.skip("ffmpeg not available on test host");
    return;
  }
  const mp3Out = join(work, "marked.mp3");
  const embedRes = run(["embed", join(work, "tone.wav"), mp3Out, "--id", "8675309", "--key", "demo-secret", "--band", "mid"]);
  assert.equal(embedRes.status, 0, embedRes.stderr);
  assert.ok(existsSync(mp3Out));

  const detectRes = run(["detect", mp3Out, "--id", "8675309", "--key", "demo-secret"]);
  assert.equal(detectRes.status, 0, detectRes.stderr || detectRes.stdout);
  assert.match(detectRes.stdout, /detected:\s*YES/);
});

test("CLI exports forensic JSON proof and text certificate via --report and --report-txt", () => {
  const markedWav = join(work, "report_test_marked.wav");
  const reportJson = join(work, "forensic_proof.json");
  const reportTxt = join(work, "forensic_cert.txt");

  const embedRes = run(["embed", join(work, "tone.wav"), markedWav, "--id", "554433", "--key", "audit-key"]);
  assert.equal(embedRes.status, 0, embedRes.stderr);

  const detectRes = run([
    "detect",
    markedWav,
    "--id",
    "554433",
    "--key",
    "audit-key",
    "--report",
    reportJson,
    "--report-txt",
    reportTxt
  ]);

  assert.equal(detectRes.status, 0, detectRes.stderr || detectRes.stdout);
  assert.ok(existsSync(reportJson), "report JSON file should exist");
  assert.ok(existsSync(reportTxt), "report TXT certificate should exist");

  const parsedReport = JSON.parse(readFileSync(reportJson, "utf8"));
  assert.equal(parsedReport.verification.status, "WATERMARK_ID_MATCH");
  assert.equal(parsedReport.verification.recoveredPayloadId, 554433);
  assert.equal(parsedReport.verification.expectedPayloadId, 554433);
  assert.ok(parsedReport.targetFile.hashes.sha256.length === 64);
  assert.ok(parsedReport.signature.seal.length === 64);

  const certContent = readFileSync(reportTxt, "utf8");
  assert.match(certContent, /DETECTION AUDIT REPORT/);
  assert.match(certContent, /Result\s*:\s*\[WATERMARK_ID_MATCH\]/);
});

test("version and help are available without touching audio", () => {
  const version = run(["version"]);
  assert.equal(version.status, 0, version.stderr);
  assert.match(version.stdout, /Aureal Watermark v\d+\.\d+\.\d+/);

  for (const args of [["--help"], ["help"], ["embed", "--help"]]) {
    const help = run(args);
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /auralwatermark embed/);
    assert.match(help.stdout, /Exit codes/);
  }
});

test("detect --json emits parseable machine output", () => {
  const r = run(["detect", join(work, "marked.wav"), "--id", "8675309", "--key", "demo-secret", "--json"]);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const result = JSON.parse(r.stdout);
  assert.equal(result.detected, true);
  assert.equal(result.recoveredPayloadId, 8675309);
  assert.equal(result.crcOk, true);
  assert.equal(result.file, join(work, "marked.wav"));
  assert.equal(result.details.softSymbols.length, 48);
});

test("custom band accepts both lowHz:highHz and lowHz-highHz syntax", () => {
  for (const band of ["17000:19500", "17000-19500"]) {
    const out = join(work, `custom-band-${band.includes(":") ? "colon" : "hyphen"}.wav`);
    const embed = run(["embed", join(work, "tone.wav"), out, "--id", "13579", "--key", "band-key", "--band", band]);
    assert.equal(embed.status, 0, embed.stderr);
    const detect = run(["detect", out, "--id", "13579", "--key", "band-key"]);
    assert.equal(detect.status, 0, detect.stderr || detect.stdout);
    assert.match(detect.stdout, /detected:\s*YES/);
    assert.match(detect.stdout, /band hit: 17000-19500 Hz/);
  }
});

test("embed preserves 24-bit PCM and 32-bit float source depth", async () => {
  const pcm24 = join(work, "depth-24.wav");
  const gen = run(["gen", pcm24, "--seconds", "4", "--rate", "48000", "--bits", "24"]);
  assert.equal(gen.status, 0, gen.stderr);
  assert.equal((await readWavFile(pcm24)).bitsPerSample, 24);

  const marked24 = join(work, "depth-24-marked.wav");
  const embed24 = run(["embed", pcm24, marked24, "--id", "2468", "--key", "depth-key"]);
  assert.equal(embed24.status, 0, embed24.stderr);
  assert.equal((await readWavFile(marked24)).bitsPerSample, 24);

  const floatPath = join(work, "depth-float.wav");
  const samples = synthesizeSpeechLike({ seconds: 4, sampleRate: 48000, channels: 1, seed: "float" });
  await writeWavFile(floatPath, samples, { sampleRate: 48000, channels: 1, bitDepth: 32 });
  const markedFloat = join(work, "depth-float-marked.wav");
  const embedFloat = run(["embed", floatPath, markedFloat, "--id", "9876", "--key", "depth-key"]);
  assert.equal(embedFloat.status, 0, embedFloat.stderr);
  const parsedFloat = await readWavFile(markedFloat);
  assert.equal(parsedFloat.bitsPerSample, 32);
  assert.match(parsedFloat.format, /float/i);
});

test("paths with spaces, ampersands and unicode are handled", () => {
  const weirdIn = join(work, "tone & wäve source.wav");
  copyFileSync(join(work, "tone.wav"), weirdIn);
  const weirdOut = join(work, "marked & wäve out.wav");
  const embed = run(["embed", weirdIn, weirdOut, "--id", "424242", "--key", "weird-key"]);
  assert.equal(embed.status, 0, embed.stderr);
  const detect = run(["detect", weirdOut, "--id", "424242", "--key", "weird-key"]);
  assert.equal(detect.status, 0, detect.stderr || detect.stdout);
  assert.match(detect.stdout, /detected:\s*YES/);
});

test("invalid CLI input fails with exit code 2 and a clear message", () => {
  const cases = [
    [["embed", join(work, "tone.wav"), join(work, "x.wav")], /embed requires --id/],
    [["gen", join(work, "x.mp3")], /uncompressed WAV only/],
    [["embed", join(work, "tone.wav"), join(work, "x.xyz"), "--id", "1"], /Unsupported output format '\.xyz'/],
    [["detect", join(work, "marked.wav"), "--report"], /--report requires a value/],
    [["embed", join(work, "tone.wav"), join(work, "x.wav"), "--id", "1", "--key"], /--key requires a value/],
    [["embed", join(work, "tone.wav"), join(work, "x.wav"), "--id", "1", "--band", "ultrasonic"], /--band must be/],
    [["embed", join(work, "tone.wav"), join(work, "x.wav"), "--id", "not-a-number"], /--id must be a uint32/],
    [["nonsense"], /unknown command 'nonsense'/]
  ];
  for (const [args, pattern] of cases) {
    const r = run(args);
    assert.equal(r.status, 2, `expected exit 2 for ${args.join(" ")}`);
    assert.match(`${r.stdout}\n${r.stderr}`, pattern);
  }
});

test("missing input files fail cleanly instead of hanging or crashing", () => {
  const r = run(["detect", join(work, "does-not-exist.wav")]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /error:/);
});

