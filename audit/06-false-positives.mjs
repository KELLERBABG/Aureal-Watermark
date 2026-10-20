// A7: false-positive hunt — does detectWatermark "detect" on unmarked material?
import { embedWatermark, detectWatermark, synthesizeSpeechLike } from "../src/index.js";
import { whiteNoise, pinkNoise, broadband, sine } from "./lib.mjs";

const SR = 44100, KEY = "diag", ID = 883921;
const FMT = { sampleRate: SR, channels: 2 };

function biquadLP(x, hz, q = 0.7071) {
  const w0 = 2 * Math.PI * hz / SR, c = Math.cos(w0), s = Math.sin(w0), al = s / (2 * q);
  const b0 = (1 - c) / 2, b1 = 1 - c, b2 = (1 - c) / 2, a0 = 1 + al;
  const o = new Float32Array(x.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) { const y = (b0 * x[i] + b1 * x1 + b2 * x2 + 2 * c * y1 - (1 - al) * y2) / a0; x2 = x1; x1 = x[i]; y2 = y1; y1 = y; o[i] = y; }
  return o;
}
function lpStereo(pcm, hz, order = 4) {
  const out = new Float32Array(pcm.length);
  for (let c = 0; c < 2; c++) {
    const ch = new Float32Array(pcm.length / 2);
    for (let i = 0; i < ch.length; i++) ch[i] = pcm[i * 2 + c];
    let y = ch; for (let k = 0; k < order; k++) y = biquadLP(y, hz);
    for (let i = 0; i < ch.length; i++) out[i * 2 + c] = y[i];
  }
  return out;
}
const rms = (p) => { let s = 0; for (let i = 0; i < p.length; i++) s += p[i] * p[i]; return Math.sqrt(s / p.length); };

const mono = synthesizeSpeechLike({ seconds: 12, sampleRate: SR, channels: 1, seed: "claims" });
const clean = new Float32Array(mono.length * 2);
for (let i = 0; i < mono.length; i++) { clean[i * 2] = mono[i]; clean[i * 2 + 1] = mono[i]; }
const marked = embedWatermark(clean, FMT, { payloadId: ID, key: KEY });

console.log("rms clean:", rms(clean).toFixed(4), " rms marked:", rms(marked).toFixed(4));
for (const hz of [16000, 12000, 10000, 7000, 5000]) {
  console.log(`LPF ${hz}: rms marked->lp = ${rms(lpStereo(marked, hz)).toFixed(4)}   rms clean->lp = ${rms(lpStereo(clean, hz)).toFixed(4)}`);
}

function probe(label, pcm, fmt = FMT) {
  let r;
  try { r = detectWatermark(pcm, fmt, { payloadId: ID, key: KEY }); }
  catch (e) { console.log(`${label.padEnd(48)} THROW ${e.message}`); return; }
  console.log(`${label.padEnd(48)} det=${r.detected ? "YES" : "no "} conf=${r.confidence.toFixed(3)} z=${r.details.z.toFixed(1)} band=${r.details.bandUsed ? Math.round(r.details.bandUsed.lowHz) + "-" + Math.round(r.details.bandUsed.highHz) : "-"} reps=${r.reps} resampled=${r.resampled || false} drift=${r.driftFactor || "-"} bitsCorr=${JSON.stringify(r.details.bitsCorrected)}`);
}

console.log("\n=== MARKED ===");
probe("marked clean", marked);
for (const hz of [16000, 12000, 10000, 9000, 8000, 7000, 5000]) probe(`marked LPF ${hz}`, lpStereo(marked, hz));

console.log("\n=== UNMARKED CONTROLS (must never detect) ===");
probe("clean stereo", clean);
for (const hz of [16000, 12000, 10000, 9000, 8000, 7000, 5000]) probe(`clean LPF ${hz}`, lpStereo(clean, hz));

// broader false-positive sweep: 40 random broadband signals of varying length & rate
console.log("\n=== 40 random unmarked broadband files, blind + verify ===");
let vfp = 0, bfp = 0;
for (let i = 0; i < 40; i++) {
  const sr = [8000, 16000, 22050, 32000, 44100, 48000][i % 6];
  const secs = 2 + (i % 5);
  const m = broadband(Math.round(sr * secs), sr, "fp" + i);
  const inter = new Float32Array(m.length * 2);
  for (let k = 0; k < m.length; k++) { inter[k * 2] = m[k]; inter[k * 2 + 1] = m[k] * 0.9; }
  const f = { sampleRate: sr, channels: 2 };
  const rv = detectWatermark(inter, f, { payloadId: ID, key: KEY });
  const rb = detectWatermark(inter, f, { key: KEY });
  if (rv.detected) { vfp++; console.log(`  VERIFY FALSE POSITIVE: sr=${sr} secs=${secs} conf=${rv.confidence.toFixed(2)} id=${rv.recoveredPayloadId}`); }
  if (rb.detected) { bfp++; console.log(`  BLIND FALSE POSITIVE: sr=${sr} secs=${secs} conf=${rb.confidence.toFixed(2)} id=${rb.recoveredPayloadId} crc=${rb.crcOk}`); }
}
console.log(`random unmarked: verify FPs=${vfp}/40  blind FPs=${bfp}/40`);

console.log("\n=== unmarked pure silence / sine / noise at high level ===");
const n = SR * 8;
for (const [name, pcm] of Object.entries({ sine1k: sine(n, SR, 1000, 0.9), white: whiteNoise(n, "w"), pink: pinkNoise(n, "p") })) {
  const st = new Float32Array(pcm.length * 2);
  for (let k = 0; k < pcm.length; k++) { st[k * 2] = pcm[k]; st[k * 2 + 1] = pcm[k]; }
  probe(`unmarked ${name}`, st);
}

console.log("\n=== targeted false-positive test: exhaustive 2-bit CRC sweep risk ===");
// Build a synthetic signal containing only random noise in the watermark band at low level:
// the CRC sweep (76 trials/hypothesis) is expected to find spurious CRC-valid codewords.
let hits = 0, trials = 0;
for (let t = 0; t < 60; t++) {
  const sr = 44100;
  const m = whiteNoise(sr * 3, "band" + t, 0.4);
  const st = new Float32Array(m.length * 2);
  for (let k = 0; k < m.length; k++) { st[k * 2] = m[k]; st[k * 2 + 1] = m[k]; }
  const r = detectWatermark(st, { sampleRate: sr, channels: 2 }, { key: KEY });
  trials++;
  if (r.crcOk) { hits++; console.log(`  spurious CRC-valid decode: id=${r.recoveredPayloadId} conf=${r.confidence.toFixed(2)} detected=${r.detected}`); }
}
console.log(`white-noise blind decodes: crcOk=${hits}/${trials}`);
