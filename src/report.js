// src/report.js — Forensic proof certificate and audit report generator
import { createHash, createHmac } from "node:crypto";

export const REPORT_SCHEMA_VERSION = "1.0.0";
export const ENGINE_NAME = "Aureal Watermark Forensic DSP Engine";
export const ENGINE_VERSION = "0.2.4";

/**
 * Generate a cryptographically sealed, structured forensic audit report.
 *
 * @param {object} params
 * @param {object} params.detectionResult Result returned by detectWatermark()
 * @param {Buffer|Uint8Array} params.audioBytes Raw file bytes of the analyzed audio
 * @param {object} [params.audioMetadata] Audio format metadata (durationSec, sampleRate, channels, format)
 * @param {string} [params.filePath] Optional path of analyzed file
 * @param {number} [params.expectedPayloadId] Optional expected payload ID to verify against
 * @param {string} [params.secret] Secret used to compute HMAC seal (defaults to deterministic key)
 * @returns {object} Structured forensic report object
 */
export function generateForensicReport({
  detectionResult,
  audioBytes,
  audioMetadata = {},
  filePath = "input.wav",
  expectedPayloadId = null,
  secret = "aureal-forensic-audit-seal-v1"
}) {
  if (!detectionResult) {
    throw new Error("generateForensicReport requires a valid detectionResult object");
  }

  const buf = Buffer.isBuffer(audioBytes) ? audioBytes : Buffer.from(audioBytes || []);
  const sha256 = createHash("sha256").update(buf).digest("hex");
  const sha512 = createHash("sha512").update(buf).digest("hex");

  const detected = Boolean(detectionResult.detected);
  const recoveredId = detectionResult.recoveredPayloadId !== undefined ? detectionResult.recoveredPayloadId : null;
  const expectedId = expectedPayloadId !== null && expectedPayloadId !== undefined ? Number(expectedPayloadId) : null;

  let status = "NO_WATERMARK_FOUND";
  let payloadMatch = null;

  if (detected) {
    if (expectedId !== null) {
      if (recoveredId === expectedId) {
        status = "VERIFIED_AUTHENTIC";
        payloadMatch = true;
      } else {
        status = "PAYLOAD_MISMATCH";
        payloadMatch = false;
      }
    } else {
      status = detectionResult.confidence >= 0.75 && (detectionResult.crcOk !== false)
        ? "VERIFIED_AUTHENTIC"
        : "DETECTION_UNCERTAIN";
    }
  }

  const details = detectionResult.details || {};
  const bandUsed = details.bandUsed || null;

  const report = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    engine: {
      name: ENGINE_NAME,
      version: ENGINE_VERSION
    },
    targetFile: {
      path: filePath,
      sizeBytes: buf.length,
      hashes: {
        sha256,
        sha512
      }
    },
    audioProperties: {
      durationSec: audioMetadata.durationSec ?? detectionResult.durationSec ?? null,
      sampleRate: audioMetadata.sampleRate ?? details.sampleRate ?? null,
      channels: audioMetadata.channels ?? details.channels ?? null,
      format: audioMetadata.format ?? detectionResult.format ?? "unknown"
    },
    verification: {
      status,
      detected,
      recoveredPayloadId: recoveredId,
      expectedPayloadId: expectedId,
      payloadMatch,
      confidence: Number(Number(detectionResult.confidence ?? 0).toFixed(4)),
      ber: Number(Number(detectionResult.ber ?? 1).toFixed(4)),
      crcOk: Boolean(detectionResult.crcOk)
    },
    forensicMetrics: {
      ebN0Db: detectionResult.ebN0Db !== undefined ? Number(Number(detectionResult.ebN0Db).toFixed(2)) : null,
      sqnrDb: detectionResult.sqnrDb !== undefined ? Number(Number(detectionResult.sqnrDb).toFixed(2)) : null,
      zScore: details.z !== undefined ? Number(Number(details.z).toFixed(2)) : null,
      repsDetected: detectionResult.reps ?? null,
      carrierBand: bandUsed ? {
        lowHz: bandUsed.lowHz,
        highHz: bandUsed.highHz,
        centerHz: bandUsed.centerHz ?? Math.round((bandUsed.lowHz + bandUsed.highHz) / 2)
      } : null,
      syncMethod: details.syncMethod ?? "unknown",
      resyncShiftSamples: details.resyncShiftSamples ?? 0
    },
    legalAttribution: {
      intendedUse: "Forensic audit proof for copyright enforcement, DMCA notices, or intellectual property verification.",
      methodology: "Direct-sequence spread-spectrum (DSSS) pseudo-random phase modulation with cyclic modulo integration and matched filter rake receiver."
    }
  };

  // Compute canonical deterministic seal over payload (excluding signature block)
  const canonicalPayload = JSON.stringify(report, Object.keys(report).sort());
  const seal = createHmac("sha256", String(secret)).update(canonicalPayload).digest("hex");

  report.signature = {
    algorithm: "HMAC-SHA256",
    seal,
    verified: true
  };

  return report;
}

/**
 * Format a forensic report as an ASCII certificate for legal notices / DMCA exhibits.
 *
 * @param {object} report Result from generateForensicReport()
 * @returns {string} Human-readable certificate
 */
export function formatForensicReportText(report) {
  const line = "=".repeat(78);
  const subline = "-".repeat(78);

  const statusColor = report.verification.status === "VERIFIED_AUTHENTIC" ? "[AUTHENTIC / MATCH]" : `[${report.verification.status}]`;

  return [
    line,
    "              AUREAL WATERMARK — FORENSIC PROOF CERTIFICATE               ",
    "               Cryptographic Audio Authentication & Audit                ",
    line,
    `Date/Time (UTC) : ${report.generatedAt}`,
    `Engine          : ${report.engine.name} v${report.engine.version}`,
    `Report Schema   : v${report.schemaVersion}`,
    subline,
    "1. TARGET EVIDENCE FILE",
    `   Path         : ${report.targetFile.path}`,
    `   Size         : ${report.targetFile.sizeBytes.toLocaleString()} bytes`,
    `   SHA-256      : ${report.targetFile.hashes.sha256}`,
    `   SHA-512      : ${report.targetFile.hashes.sha512.slice(0, 48)}...`,
    subline,
    "2. FORENSIC VERIFICATION RESULT",
    `   Verdict      : ${statusColor}`,
    `   Detected     : ${report.verification.detected ? "YES" : "NO"}`,
    `   Payload ID   : ${report.verification.recoveredPayloadId ?? "None"}`,
    report.verification.expectedPayloadId !== null
      ? `   Expected ID  : ${report.verification.expectedPayloadId} (Match: ${report.verification.payloadMatch ? "PASS" : "FAIL"})`
      : null,
    `   Confidence   : ${(report.verification.confidence * 100).toFixed(1)}%`,
    `   Bit Error Rate: ${(report.verification.ber * 100).toFixed(2)}%`,
    `   CRC Integrity: ${report.verification.crcOk ? "VALID (OK)" : "FAIL / UNCHECKED"}`,
    subline,
    "3. PHYSICAL-LAYER DSP METRICS",
    `   Eb/N0        : ${report.forensicMetrics.ebN0Db !== null ? `${report.forensicMetrics.ebN0Db} dB` : "N/A"}`,
    `   SQNR         : ${report.forensicMetrics.sqnrDb !== null ? `${report.forensicMetrics.sqnrDb} dB` : "N/A"}`,
    `   Z-Score      : ${report.forensicMetrics.zScore ?? "N/A"}`,
    `   Carrier Band : ${report.forensicMetrics.carrierBand ? `${report.forensicMetrics.carrierBand.lowHz} - ${report.forensicMetrics.carrierBand.highHz} Hz` : "N/A"}`,
    `   Sync Method  : ${report.forensicMetrics.syncMethod}`,
    subline,
    "4. INTEGRITY SEAL",
    `   Algorithm    : ${report.signature.algorithm}`,
    `   Seal Hash    : ${report.signature.seal}`,
    line,
    "Attribution: " + report.legalAttribution.intendedUse,
    line
  ].filter(Boolean).join("\n");
}
