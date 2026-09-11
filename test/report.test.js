// test/report.test.js — Tests for Forensic Proof Certificate Generator
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";

import {
  generateForensicReport,
  formatForensicReportText,
  REPORT_SCHEMA_VERSION,
  ENGINE_NAME,
  ENGINE_VERSION
} from "../src/report.js";
import { synthesizeSpeechLike } from "../src/synth.js";
import { embedWatermark } from "../src/embed.js";
import { detectWatermark } from "../src/detect.js";
import { writeWav } from "../src/wav.js";

test("generateForensicReport produces valid schema and matching hashes", () => {
  const pcm = synthesizeSpeechLike({ seconds: 3, sampleRate: 44100, channels: 1 });
  const watermarked = embedWatermark(pcm, { sampleRate: 44100, channels: 1 }, { payloadId: 123456 });
  const wavBuf = writeWav(watermarked, { sampleRate: 44100, channels: 1, bitDepth: 16 });

  const detection = detectWatermark(watermarked, { sampleRate: 44100, channels: 1 });
  assert.equal(detection.detected, true);

  const report = generateForensicReport({
    detectionResult: detection,
    audioBytes: wavBuf,
    audioMetadata: { durationSec: 3, sampleRate: 44100, channels: 1, format: "PCM 16-bit" },
    filePath: "evidence.wav",
    expectedPayloadId: 123456,
    secret: "test-forensic-secret"
  });

  // Verify core schema
  assert.equal(report.schemaVersion, REPORT_SCHEMA_VERSION);
  assert.equal(report.engine.name, ENGINE_NAME);
  assert.equal(report.engine.version, ENGINE_VERSION);
  assert.equal(report.targetFile.path, "evidence.wav");
  assert.equal(report.targetFile.sizeBytes, wavBuf.length);

  // Check cryptographic file hashes
  const expectedSha256 = createHash("sha256").update(wavBuf).digest("hex");
  const expectedSha512 = createHash("sha512").update(wavBuf).digest("hex");
  assert.equal(report.targetFile.hashes.sha256, expectedSha256);
  assert.equal(report.targetFile.hashes.sha512, expectedSha512);

  // Check verification block
  assert.equal(report.verification.status, "VERIFIED_AUTHENTIC");
  assert.equal(report.verification.detected, true);
  assert.equal(report.verification.recoveredPayloadId, 123456);
  assert.equal(report.verification.expectedPayloadId, 123456);
  assert.equal(report.verification.payloadMatch, true);
  assert.equal(report.verification.crcOk, true);
  assert.ok(report.verification.confidence >= 0.95);
  assert.equal(report.verification.ber, 0);

  // Check forensic metrics
  assert.ok(typeof report.forensicMetrics.ebN0Db === "number");
  assert.ok(typeof report.forensicMetrics.sqnrDb === "number");
  assert.ok(report.forensicMetrics.carrierBand !== null);
  assert.ok(report.forensicMetrics.carrierBand.lowHz > 0);

  // Check signature
  assert.equal(report.signature.algorithm, "HMAC-SHA256");
  assert.ok(typeof report.signature.seal === "string" && report.signature.seal.length === 64);

  // Verify seal determinism
  const { signature, ...body } = report;
  const canonical = JSON.stringify(body, Object.keys(body).sort());
  const expectedSeal = createHmac("sha256", "test-forensic-secret").update(canonical).digest("hex");
  assert.equal(report.signature.seal, expectedSeal);
});

test("generateForensicReport flags PAYLOAD_MISMATCH when ID differs", () => {
  const dummyDetection = {
    detected: true,
    recoveredPayloadId: 999999,
    confidence: 0.99,
    ber: 0,
    crcOk: true,
    ebN0Db: 15.0,
    sqnrDb: 18.0,
    reps: 3,
    details: {
      mode: "blind",
      sampleRate: 44100,
      channels: 1,
      bandUsed: { lowHz: 17000, highHz: 19500 }
    }
  };

  const report = generateForensicReport({
    detectionResult: dummyDetection,
    audioBytes: Buffer.from("dummy-audio-bytes"),
    expectedPayloadId: 111111
  });

  assert.equal(report.verification.status, "PAYLOAD_MISMATCH");
  assert.equal(report.verification.recoveredPayloadId, 999999);
  assert.equal(report.verification.expectedPayloadId, 111111);
  assert.equal(report.verification.payloadMatch, false);
});

test("generateForensicReport handles undetected audio properly", () => {
  const dummyDetection = {
    detected: false,
    recoveredPayloadId: null,
    confidence: 0.1,
    ber: 0.5,
    crcOk: false,
    details: {
      mode: "blind"
    }
  };

  const report = generateForensicReport({
    detectionResult: dummyDetection,
    audioBytes: Buffer.from("clean-audio-bytes")
  });

  assert.equal(report.verification.status, "NO_WATERMARK_FOUND");
  assert.equal(report.verification.detected, false);
  assert.equal(report.verification.recoveredPayloadId, null);
});

test("formatForensicReportText outputs clean formatted certificate", () => {
  const dummyReport = {
    schemaVersion: "1.0.0",
    generatedAt: "2026-09-11T10:00:00.000Z",
    engine: { name: ENGINE_NAME, version: ENGINE_VERSION },
    targetFile: {
      path: "evidence.wav",
      sizeBytes: 1048576,
      hashes: {
        sha256: "a1b2c3d4e5f67890123456789abcdef0123456789abcdef0123456789abcdef0",
        sha512: "fedcba9876543210fedcba9876543210fedcba9876543210fedcba98765432100123456789abcdef0123456789abcdef"
      }
    },
    audioProperties: {
      durationSec: 12.5,
      sampleRate: 44100,
      channels: 2,
      format: "PCM 16-bit"
    },
    verification: {
      status: "VERIFIED_AUTHENTIC",
      detected: true,
      recoveredPayloadId: 445566,
      expectedPayloadId: 445566,
      payloadMatch: true,
      confidence: 1.0,
      ber: 0.0,
      crcOk: true
    },
    forensicMetrics: {
      ebN0Db: 14.5,
      sqnrDb: 17.8,
      zScore: 32.1,
      carrierBand: { lowHz: 17000, highHz: 19500 },
      syncMethod: "preamble"
    },
    legalAttribution: {
      intendedUse: "Forensic audit proof for copyright enforcement, DMCA notices, or intellectual property verification."
    },
    signature: {
      algorithm: "HMAC-SHA256",
      seal: "9876543210abcdef9876543210abcdef9876543210abcdef9876543210abcdef"
    }
  };

  const text = formatForensicReportText(dummyReport);
  assert.ok(text.includes("AUREAL WATERMARK — FORENSIC PROOF CERTIFICATE"));
  assert.ok(text.includes("SHA-256      : a1b2c3d4e5f67890123456789abcdef0123456789abcdef0123456789abcdef0"));
  assert.ok(text.includes("Payload ID   : 445566"));
  assert.ok(text.includes("Verdict      : [AUTHENTIC / MATCH]"));
  assert.ok(text.includes("100.0%"));
});
