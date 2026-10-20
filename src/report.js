// src/report.js — Watermark detection audit report generator
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const REPORT_SCHEMA_VERSION = "1.1.0";
export const ENGINE_NAME = "Aureal Watermark DSP Engine";
export const ENGINE_VERSION = "0.2.7";

const DEFAULT_SECRET = "aureal-forensic-audit-seal-v1";
const CANONICALIZATION = "sorted-keys-json-v1";

/**
 * Deterministic deep serialisation: object keys are sorted recursively and
 * `undefined` values are dropped, so the same report always produces the same
 * bytes regardless of property insertion order or JSON round-tripping.
 */
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] === undefined) continue;
      out[key] = canonicalize(value[key]);
    }
    return out;
  }
  return value;
}

/** Canonical JSON string of a report body (everything except `signature`). */
export function canonicalReportBody(report) {
  const { signature, ...body } = report || {};
  void signature;
  return JSON.stringify(canonicalize(body));
}

function sealFor(reportBody, secret) {
  return createHmac("sha256", String(secret ?? DEFAULT_SECRET))
    .update(canonicalReportBody(reportBody))
    .digest("hex");
}

/**
 * Generate a structured detection audit report with file hashes and an HMAC integrity seal.
 * The seal covers the whole report body (hashes, verdict, payload ID, metrics) — not just a
 * few top-level fields — and can be checked with verifyForensicReport(). It is a shared-secret
 * HMAC, not a public-key signature: it proves the report was produced by someone holding the
 * secret, and that it has not been modified since.
 *
 * @param {object} params
 * @param {object} params.detectionResult Result returned by detectWatermark()
 * @param {Buffer|Uint8Array} params.audioBytes Raw file bytes of the analyzed audio
 * @param {object} [params.audioMetadata] Audio format metadata (durationSec, sampleRate, channels, format)
 * @param {string} [params.filePath] Optional path of analyzed file
 * @param {number} [params.expectedPayloadId] Optional expected payload ID to verify against
 * @param {string} [params.secret] Shared secret used to compute the HMAC (defaults to a public deterministic key)
 * @returns {object} Structured forensic report object
 */
export function generateForensicReport({
  detectionResult,
  audioBytes,
  audioMetadata = {},
  filePath = "input.wav",
  expectedPayloadId = null,
  secret = DEFAULT_SECRET
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

  if (detected && expectedId !== null) {
    if (recoveredId === expectedId) {
      status = "WATERMARK_ID_MATCH";
      payloadMatch = true;
    } else {
      status = "PAYLOAD_MISMATCH";
      payloadMatch = false;
    }
  } else if (detected) {
    status = detectionResult.confidence >= 0.75 && (detectionResult.crcOk !== false)
      ? "WATERMARK_DETECTED"
      : "DETECTION_UNCERTAIN";
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
    interpretation: {
      note: "A watermark match is not proof of authorship, ownership, identity, creation time, or chain of custody.",
      methodology: "Direct-sequence spread-spectrum (DSSS) pseudo-random phase modulation with cyclic modulo integration and matched filter rake receiver."
    }
  };

  // Seal the full report body. The default secret is public, so production users
  // should supply and protect a private shared secret; this is not a digital signature.
  report.signature = {
    algorithm: "HMAC-SHA256",
    canonicalization: CANONICALIZATION,
    covers: "entire report body except this signature object",
    seal: sealFor(report, secret)
  };

  return report;
}

/**
 * Verify the integrity seal of a report produced by generateForensicReport().
 *
 * @param {object} report Parsed report (e.g. from JSON)
 * @param {{secret?: string}} [opts]
 * @returns {{valid: boolean, reason: string, expected?: string, actual?: string}}
 */
export function verifyForensicReport(report, opts = {}) {
  const secret = opts.secret ?? DEFAULT_SECRET;
  if (!report || typeof report !== "object") {
    return { valid: false, reason: "report is not an object" };
  }
  const sig = report.signature;
  if (!sig || typeof sig !== "object" || typeof sig.seal !== "string") {
    return { valid: false, reason: "report has no HMAC seal" };
  }
  if (sig.canonicalization !== CANONICALIZATION) {
    return {
      valid: false,
      reason: `unsupported seal canonicalisation '${sig.canonicalization ?? "none"}' (this report predates schema ${REPORT_SCHEMA_VERSION} or was produced by an older build)`
    };
  }
  const expected = sealFor(report, secret);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(sig.seal, "hex");
  const valid = a.length === b.length && timingSafeEqual(a, b);
  return {
    valid,
    reason: valid ? "seal matches the report body" : "seal does not match the report body (report modified, or wrong secret)",
    expected: expected.slice(0, 16) + "…",
    actual: sig.seal.slice(0, 16) + "…"
  };
}

/**
 * Format a forensic report as a human-readable detection audit report.
 *
 * @param {object} report Result from generateForensicReport()
 * @returns {string} Human-readable certificate
 */
export function formatForensicReportText(report) {
  const line = "=".repeat(78);
  const subline = "-".repeat(78);

  const statusLabel = `[${report.verification.status}]`;

  return [
    line,
    "              AUREAL WATERMARK — DETECTION AUDIT REPORT               ",
    "                 Watermark ID Matching Results                        ",
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
    "2. WATERMARK DETECTION RESULT",
    `   Result       : ${statusLabel}`,
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
    "4. REPORT INTEGRITY SEAL (shared-secret HMAC, not an identity signature)",
    `   Algorithm    : ${report.signature.algorithm}`,
    `   Covers       : ${report.signature.covers || "entire report body"}`,
    `   Seal Hash    : ${report.signature.seal}`,
    "   Verify with  : auralwatermark verify-report <file> --key <secret>",
    line,
    "Note: A watermark match is not proof of authorship or legal attribution.",
    line
  ].filter(Boolean).join("\n");
}
