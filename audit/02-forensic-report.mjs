// 02: forensic report seal — generation, third-party verification, tamper detection
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  embedWatermark, detectWatermark, generateForensicReport, formatForensicReportText, verifyForensicReport,
} from "../src/index.js";
import { broadband } from "./lib.mjs";

const SR = 44100, ID = 555444;
const raw = broadband(SR * 6, SR, "rep");
const fmt = { sampleRate: SR, channels: 2 };
const st = new Float32Array(raw.length * 2);
for (let i = 0; i < raw.length; i++) { st[i * 2] = raw[i]; st[i * 2 + 1] = raw[i]; }
const marked = embedWatermark(st, fmt, { payloadId: ID, key: "k1" });

function toWav(samples, sampleRate, channels) {
  const frames = samples.length / channels, dataLen = frames * channels * 2, padded = dataLen + (dataLen & 1);
  const buf = Buffer.alloc(44 + padded);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + padded, 4); buf.write("WAVE", 8); buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(channels, 22); buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * channels * 2, 28); buf.writeUInt16LE(channels * 2, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(dataLen, 40);
  let p = 44;
  for (let i = 0; i < samples.length; i++) { buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), p); p += 2; }
  return buf;
}
const wavBuf = toWav(marked, SR, 2);
const wav = { samples: marked, sampleRate: SR, channels: 2 };

const res = detectWatermark(wav.samples, fmt, { payloadId: ID, key: "k1" });
console.log("detected:", res.detected, "id:", res.recoveredPayloadId, "conf:", res.confidence.toFixed(3));

const report = generateForensicReport({
  detectionResult: res, audioBytes: wavBuf,
  audioMetadata: { durationSec: wav.samples.length / 2 / SR, sampleRate: SR, channels: 2, format: "PCM 16-bit" },
  filePath: "test.wav", expectedPayloadId: ID, secret: "k1"
});

const outDir = mkdtempSync(join(tmpdir(), "aureal-report-"));
const reportPath = join(outDir, "report.json");
writeFileSync(reportPath, JSON.stringify(report, null, 2));
writeFileSync(join(outDir, "report.txt"), formatForensicReportText(report));
console.log("report written to", outDir);
console.log("schema:", report.schemaVersion, "status:", report.verification.status);
console.log("seal:", report.signature.seal);

const checks = [];
const check = (name, pass, detail = "") => checks.push({ name, pass: !!pass, detail });

check("verifies with the generating secret", verifyForensicReport(report, { secret: "k1" }).valid);
check("rejects a wrong secret", !verifyForensicReport(report, { secret: "other" }).valid);

// A third party loads the JSON back from disk and verifies it — must still pass.
const roundTripped = JSON.parse(readFileSync(reportPath, "utf8"));
check("verifies after a JSON round-trip (third party)", verifyForensicReport(roundTripped, { secret: "k1" }).valid);

// Every field that matters must be covered by the seal.
const tampers = {
  "verification.recoveredPayloadId": (r) => { r.verification.recoveredPayloadId = 999999; },
  "verification.detected": (r) => { r.verification.detected = false; },
  "verification.status": (r) => { r.verification.status = "PAYLOAD_MISMATCH"; },
  "targetFile.hashes.sha256": (r) => { r.targetFile.hashes.sha256 = "0".repeat(64); },
  "targetFile.sizeBytes": (r) => { r.targetFile.sizeBytes += 1; },
  "forensicMetrics.zScore": (r) => { r.forensicMetrics.zScore = 1234; },
  "generatedAt": (r) => { r.generatedAt = "2000-01-01T00:00:00.000Z"; },
  "audioProperties.durationSec": (r) => { r.audioProperties.durationSec = 1; },
  "interpretation.note": (r) => { r.interpretation.note = "ownership proven"; },
};
for (const [field, mutate] of Object.entries(tampers)) {
  const forged = JSON.parse(JSON.stringify(report));
  mutate(forged);
  const v = verifyForensicReport(forged, { secret: "k1" });
  check(`tampering ${field} is detected`, !v.valid, v.reason);
}

// A report sealed with the same public default as everyone else is still valid, just weak.
const defaultSealed = generateForensicReport({ detectionResult: res, audioBytes: wavBuf, expectedPayloadId: ID });
check("default-secret report verifies with the default secret", verifyForensicReport(defaultSealed).valid);

// Legacy (pre-1.1.0) reports cannot be verified and must say so.
const legacy = JSON.parse(JSON.stringify(report));
legacy.signature.canonicalization = undefined;
check("legacy report is reported as unverifiable", !verifyForensicReport(legacy, { secret: "k1" }).valid);

console.log("\n" + formatForensicReportText(report));

let fails = 0;
for (const c of checks) { if (!c.pass) fails++; console.log(`${c.pass ? "PASS" : "FAIL"}  ${c.name}${c.detail ? "  [" + c.detail + "]" : ""}`); }
console.log(`\n${checks.length - fails}/${checks.length} passed`);
