// A13: focused evidence — (1) report seal forgery, (2) wrong-band reporting, (3) band collapse, (4) license gating
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { embedWatermark, detectWatermark, synthesizeSpeechLike, generateForensicReport, formatForensicReportText, verifyForensicReport } from "../src/index.js";

const SR = 44100;
const KEY = "audit-key";
const FMT = { sampleRate: SR, channels: 2 };

function mkSpeech(secs = 6, seed = "x") {
  const mono = synthesizeSpeechLike({ seconds: secs, sampleRate: SR, channels: 1, seed });
  const st = new Float32Array(mono.length * 2);
  for (let i = 0; i < mono.length; i++) { st[i * 2] = mono[i]; st[i * 2 + 1] = mono[i]; }
  return st;
}
function toWav(samples, sr, ch) {
  const frames = samples.length / ch, dataLen = frames * ch * 2, padded = dataLen + (dataLen & 1);
  const b = Buffer.alloc(44 + padded);
  b.write("RIFF", 0); b.writeUInt32LE(36 + padded, 4); b.write("WAVE", 8); b.write("fmt ", 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(ch, 22); b.writeUInt32LE(sr, 24);
  b.writeUInt32LE(sr * ch * 2, 28); b.writeUInt16LE(ch * 2, 32); b.writeUInt16LE(16, 34);
  b.write("data", 36); b.writeUInt32LE(dataLen, 40);
  let p = 44;
  for (let i = 0; i < samples.length; i++) { const s = Math.max(-1, Math.min(1, samples[i])); b.writeInt16LE(Math.round(s * 32767), p); p += 2; }
  return b;
}

console.log("=== EVIDENCE 1: the HMAC seal covers the report body (regression check for audit finding F2) ===");
const clean = mkSpeech(8, "clean-a");
const cleanWav = toWav(clean, SR, 2);
// a detection on UNMARKED audio => status NO_WATERMARK_FOUND
const cleanDet = detectWatermark(clean, FMT, { payloadId: 999999, key: KEY });
const honest = generateForensicReport({ detectionResult: cleanDet, audioBytes: cleanWav, filePath: "suspect.wav", expectedPayloadId: 999999, secret: KEY });
console.log("  honest status   :", honest.verification.status, "| detected:", honest.verification.detected);
// forge it: claim a match for a different id, and even swap the sha256
const forged = JSON.parse(JSON.stringify(honest));
forged.verification.status = "WATERMARK_ID_MATCH";
forged.verification.detected = true;
forged.verification.recoveredPayloadId = 999999;
forged.verification.payloadMatch = true;
forged.verification.confidence = 1.0;
forged.verification.ber = 0;
forged.verification.crcOk = true;
forged.targetFile.hashes.sha256 = "0".repeat(64);
forged.targetFile.sizeBytes = 12345;
console.log("  forged status   :", forged.verification.status);
console.log("  forged sha256   :", forged.targetFile.hashes.sha256.slice(0, 16) + "...");
const sealCheck = verifyForensicReport(forged, { secret: KEY });
console.log("  seal after tampering:", sealCheck.valid ? "STILL VALID (bad)" : "REJECTED (good) —", sealCheck.reason);
console.log("  honest report still verifies:", verifyForensicReport(honest, { secret: KEY }).valid);

console.log("\n=== EVIDENCE 2: detection can report the wrong carrier band ===");
// embed in the HIGH band only; low-pass at 18 kHz (removes most of 17-19.5k);
// the detector then reports a MID-band hit at full confidence even though no mid watermark was embedded.
const markedHigh = embedWatermark(mkSpeech(12, "band"), FMT, { payloadId: 424242, key: KEY, band: "high" });
function biquad(x, hz) {
  const w0 = (2 * Math.PI * hz) / SR, c = Math.cos(w0), s = Math.sin(w0), al = s / (2 * 0.7071);
  const b0 = (1 - c) / 2, b1 = 1 - c, b2 = (1 - c) / 2, a0 = 1 + al;
  const o = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const y = (b0 * x[i] + b1 * x1 + b2 * x2 + 2 * c * y1 - (1 - al) * y2) / a0;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = y; o[i] = y;
  }
  return o;
}
function lp(pcm, hz, order = 4) {
  const out = new Float32Array(pcm.length);
  for (let ch = 0; ch < 2; ch++) {
    const chData = new Float32Array(pcm.length / 2);
    for (let i = 0; i < chData.length; i++) chData[i] = pcm[i * 2 + ch];
    let y = chData;
    for (let k = 0; k < order; k++) y = biquad(y, hz);
    for (let i = 0; i < chData.length; i++) out[i * 2 + ch] = y[i];
  }
  return out;
}
const filtered = lp(markedHigh, 18000);
console.log("  verify with band:'high' :", JSON.stringify((() => { const r = detectWatermark(filtered, FMT, { payloadId: 424242, key: KEY, band: "high", resample: false, drift: false }); return { detected: r.detected, band: r.details.bandUsed, conf: +r.confidence.toFixed(2), z: +r.details.z.toFixed(1) }; })()));
console.log("  verify with band:'mid'  :", JSON.stringify((() => { const r = detectWatermark(filtered, FMT, { payloadId: 424242, key: KEY, band: "mid", resample: false, drift: false }); return { detected: r.detected, band: r.details.bandUsed, conf: +r.confidence.toFixed(2), z: +r.details.z.toFixed(1) }; })()));
console.log("  same file, band:'mid', no filtering:", JSON.stringify((() => { const r = detectWatermark(markedHigh, FMT, { payloadId: 424242, key: KEY, band: "mid", resample: false, drift: false }); return { detected: r.detected, conf: +r.confidence.toFixed(2), z: +r.details.z.toFixed(1) }; })()));
console.log("  -> filtering can flip the OTHER band's hypothesis from z=-0.4 to a full-confidence hit;\n     the same spreading sequence is reused for every band, so the hypotheses are not orthogonal");

console.log("\n=== EVIDENCE 3: carrier band collapses at low sample rates ===");
for (const sr of [8000, 11025, 16000, 22050, 44100]) {
  const n = sr * 3;
  const mono = new Float32Array(n);
  for (let i = 0; i < n; i++) mono[i] = 0.4 * Math.sin(2 * Math.PI * 300 * i / sr);
  const st = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { st[i * 2] = mono[i]; st[i * 2 + 1] = mono[i]; }
  const m = embedWatermark(st, { sampleRate: sr, channels: 2 }, { payloadId: 777 });
  const b = m.watermarkMeta.bands;
  console.log(`  sr=${String(sr).padStart(5)}  bands: ` + b.map((x) => `${x.lowHz}-${x.highHz} (center ${x.centerHz})`).join("  |  "));
}

console.log("\n=== EVIDENCE 4: the commercial licence gates nothing ===");
const status = (await import("../src/license.js")).getLicenseStatus();
console.log("  local licence file present:", status.isLicensed, status.tier);
const a = embedWatermark(mkSpeech(3, "lic"), FMT, { payloadId: 1 });
console.log("  embedWatermark succeeds with no licence:", a.length > 0);
const det = detectWatermark(a, FMT, { payloadId: 1 });
console.log("  detectWatermark succeeds with no licence:", det.detected);
const rep = generateForensicReport({ detectionResult: det, audioBytes: toWav(a, SR, 2), expectedPayloadId: 1, secret: KEY });
console.log("  forensic report generated with no licence:", !!rep.signature.seal);
