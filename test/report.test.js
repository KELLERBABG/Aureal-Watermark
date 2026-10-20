import test from "node:test";
import assert from "node:assert/strict";
import {
  embedWatermark,
  detectWatermark,
  generateForensicReport,
  verifyForensicReport,
  canonicalReportBody,
  formatForensicReportText,
  REPORT_SCHEMA_VERSION,
} from "../src/index.js";
import { tone, wavBuffer } from "./helpers.js";

const SR = 44100;
const ID = 555444;
const SECRET = "test-secret";
const FMT = { sampleRate: SR, channels: 2 };

function fixture() {
  const clean = tone(6, SR, 2, "report");
  const marked = embedWatermark(clean, FMT, { payloadId: ID, key: SECRET });
  const res = detectWatermark(marked, FMT, { payloadId: ID, key: SECRET });
  const report = generateForensicReport({
    detectionResult: res,
    audioBytes: wavBuffer(marked, SR, 2),
    audioMetadata: { durationSec: 6, sampleRate: SR, channels: 2, format: "PCM 16-bit" },
    filePath: "evidence.wav",
    expectedPayloadId: ID,
    secret: SECRET,
  });
  return { clean, marked, res, report };
}

test("report carries a versioned schema, hashes and the expected verdict", () => {
  const { report } = fixture();
  assert.equal(report.schemaVersion, REPORT_SCHEMA_VERSION);
  assert.equal(report.verification.status, "WATERMARK_ID_MATCH");
  assert.equal(report.verification.recoveredPayloadId, ID);
  assert.match(report.targetFile.hashes.sha256, /^[0-9a-f]{64}$/);
  assert.match(report.targetFile.hashes.sha512, /^[0-9a-f]{128}$/);
  assert.equal(report.targetFile.sizeBytes, wavBuffer(tone(6, SR, 2, "report"), SR, 2).length);
  assert.equal(report.signature.algorithm, "HMAC-SHA256");
  assert.equal(report.signature.canonicalization, "sorted-keys-json-v1");
});

test("the seal verifies with the right secret and fails with a wrong one", () => {
  const { report } = fixture();
  assert.equal(verifyForensicReport(report, { secret: SECRET }).valid, true);
  assert.equal(verifyForensicReport(report, { secret: "wrong" }).valid, false);
});

test("verification survives a JSON round-trip (third-party use)", () => {
  const { report } = fixture();
  const roundTripped = JSON.parse(JSON.stringify(report));
  assert.equal(verifyForensicReport(roundTripped, { secret: SECRET }).valid, true);
});

test("the seal covers every meaningful field: tampering is detected", () => {
  const { report } = fixture();
  const tamperers = [
    (r) => { r.verification.recoveredPayloadId = 999999; },
    (r) => { r.verification.detected = false; },
    (r) => { r.verification.status = "PAYLOAD_MISMATCH"; },
    (r) => { r.verification.confidence = 0.12; },
    (r) => { r.targetFile.hashes.sha256 = "0".repeat(64); },
    (r) => { r.targetFile.sizeBytes += 1; },
    (r) => { r.forensicMetrics.zScore = 4321; },
    (r) => { r.audioProperties.durationSec = 1; },
    (r) => { r.generatedAt = "2000-01-01T00:00:00.000Z"; },
    (r) => { r.interpretation.note = "ownership proven"; },
  ];
  for (const tamper of tamperers) {
    const forged = JSON.parse(JSON.stringify(report));
    tamper(forged);
    assert.equal(verifyForensicReport(forged, { secret: SECRET }).valid, false, tamper.toString());
  }
});

test("a report without a seal, or with a legacy canonicalisation, is rejected", () => {
  const { report } = fixture();
  const noSeal = JSON.parse(JSON.stringify(report));
  delete noSeal.signature;
  assert.equal(verifyForensicReport(noSeal, { secret: SECRET }).valid, false);

  const legacy = JSON.parse(JSON.stringify(report));
  legacy.signature.canonicalization = "legacy";
  const res = verifyForensicReport(legacy, { secret: SECRET });
  assert.equal(res.valid, false);
  assert.match(res.reason, /canonicalisation/);

  assert.equal(verifyForensicReport(null).valid, false);
  assert.equal(verifyForensicReport("nope").valid, false);
});

test("the canonical body is stable regardless of property order", () => {
  const { report } = fixture();
  const reordered = {};
  for (const key of Object.keys(report).reverse()) reordered[key] = report[key];
  assert.equal(canonicalReportBody(reordered), canonicalReportBody(report));
});

test("an unmarked file yields NO_WATERMARK_FOUND and still seals", () => {
  const clean = tone(6, SR, 2, "clean-report");
  const res = detectWatermark(clean, FMT, { payloadId: ID, key: SECRET });
  const report = generateForensicReport({
    detectionResult: res,
    audioBytes: wavBuffer(clean, SR, 2),
    expectedPayloadId: ID,
    secret: SECRET,
  });
  assert.equal(report.verification.status, "NO_WATERMARK_FOUND");
  assert.equal(report.verification.detected, false);
  assert.equal(verifyForensicReport(report, { secret: SECRET }).valid, true);
});

test("the text certificate names what the seal covers and how to verify it", () => {
  const { report } = fixture();
  const text = formatForensicReportText(report);
  assert.match(text, /REPORT INTEGRITY SEAL/);
  assert.match(text, /entire report body/);
  assert.match(text, /verify-report/);
  assert.match(text, /not proof of authorship/i);
});

test("generateForensicReport requires a detection result", () => {
  assert.throws(() => generateForensicReport({ audioBytes: Buffer.alloc(0) }), /detectionResult/);
});
