// A6: band-by-band reliability diagnostics
import { embedWatermark, detectWatermark, synthesizeSpeechLike } from "../src/index.js";
import { snrDb } from "./lib.mjs";

const SR = 44100, ID = 883921, KEY = "diag", SECS = 12;
const mono = synthesizeSpeechLike({ seconds: SECS, sampleRate: SR, channels: 1, seed: "claims" });
const clean = new Float32Array(mono.length * 2);
for (let i = 0; i < mono.length; i++) { clean[i * 2] = mono[i]; clean[i * 2 + 1] = mono[i]; }
const FMT = { sampleRate: SR, channels: 2 };

function d(pcm, fmt, opts) {
  const r = detectWatermark(pcm, { sampleRate: fmt.sampleRate, channels: fmt.channels }, { payloadId: ID, key: KEY, ...opts });
  return `det=${r.detected ? "Y" : "n"} conf=${r.confidence.toFixed(3)} band=${r.details.bandUsed ? Math.round(r.details.bandUsed.lowHz) + "-" + Math.round(r.details.bandUsed.highHz) : "-"} z=${r.details.z.toFixed(1)}`;
}
console.log("== embed band vs detect band (clean, no processing) ==");
for (const eb of ["high", "mid", "dual"]) {
  const m = embedWatermark(clean, FMT, { payloadId: ID, key: KEY, band: eb });
  console.log(`embed=${eb.padEnd(4)} snr=${snrDb(clean, m).toFixed(1)}  |  auto: ${d(m, FMT, {})}`);
  console.log(`                       |  high: ${d(m, FMT, { band: "high" })}`);
  console.log(`                       |  mid : ${d(m, FMT, { band: "mid" })}`);
}

console.log("\n== low-pass sweep on a DUAL-band watermark (auto detect) ==");
const dual = embedWatermark(clean, FMT, { payloadId: ID, key: KEY, band: "dual" });
function biquadLP(x, hz, q = 0.7071) {
  const w0 = 2 * Math.PI * hz / SR, c = Math.cos(w0), s = Math.sin(w0), al = s / (2 * q);
  const b0 = (1 - c) / 2, b1 = 1 - c, b2 = (1 - c) / 2, a0 = 1 + al;
  const o = new Float32Array(x.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) { const y = (b0 * x[i] + b1 * x1 + b2 * x2 + 2 * c * y1 - (1 - al) * y2) / a0; x2 = x1; x1 = x[i]; y2 = y1; y1 = y; o[i] = y; }
  return o;
}
function lp(pcm, hz, order = 4) {
  const out = new Float32Array(pcm.length);
  for (let c = 0; c < 2; c++) {
    const ch = new Float32Array(pcm.length / 2);
    for (let i = 0; i < ch.length; i++) ch[i] = pcm[i * 2 + c];
    let y = ch; for (let k = 0; k < order; k++) y = biquadLP(y, hz);
    for (let i = 0; i < ch.length; i++) out[i * 2 + c] = y[i];
  }
  return out;
}
for (const hz of [20000, 18000, 16000, 14000, 12000, 10000, 9000, 8000, 7000, 5000]) {
  const f = lp(dual, hz);
  console.log(`LPF ${String(hz).padStart(5)} Hz (8th order, dual embed) | auto: ${d(f, FMT, {})}`);
}

console.log("\n== crop-offset sweep: 1.8 s excerpt starting at t = ... ==");
let pass = 0, fail = 0;
const offsets = [];
for (let t = 0; t <= SECS - 1.8 - 0.001; t += 0.11) offsets.push(+t.toFixed(2));
for (const t of offsets) {
  const start = Math.floor(t * SR) * 2, len = Math.floor(1.8 * SR) * 2;
  const seg = dual.subarray(start, start + len);
  const r = detectWatermark(seg, FMT, { payloadId: ID, key: KEY });
  if (r.detected) pass++; else { fail++; console.log(`  FAIL crop at ${t}s conf=${r.confidence.toFixed(3)} z=${r.details.z.toFixed(1)}`); }
}
console.log(`crop sweep: ${pass} pass / ${fail} fail of ${offsets.length} offsets`);

console.log("\n== 1.0 s crop sweep ==");
pass = 0; fail = 0;
for (let t = 0; t <= SECS - 1.0 - 0.001; t += 0.23) {
  const start = Math.floor(t * SR) * 2, len = Math.floor(1.0 * SR) * 2;
  const r = detectWatermark(dual.subarray(start, start + len), FMT, { payloadId: ID, key: KEY });
  if (r.detected) pass++; else fail++;
}
console.log(`1.0s crop sweep: ${pass} pass / ${fail} fail`);

console.log("\n== 0.5 s crop sweep ==");
pass = 0; fail = 0;
for (let t = 0; t <= SECS - 0.5 - 0.001; t += 0.31) {
  const start = Math.floor(t * SR) * 2, len = Math.floor(0.5 * SR) * 2;
  try { const r = detectWatermark(dual.subarray(start, start + len), FMT, { payloadId: ID, key: KEY }); if (r.detected) pass++; else fail++; }
  catch (e) { fail++; }
}
console.log(`0.5s crop sweep: ${pass} pass / ${fail} fail`);
