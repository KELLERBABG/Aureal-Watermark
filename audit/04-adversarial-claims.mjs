// A5c: README adversarial-claim matrix, format-aware, cheap transforms
import { embedWatermark, detectWatermark, synthesizeSpeechLike } from "../src/index.js";
import { resamplePcm } from "../src/resample.js";
import { pinkNoise, snrDb } from "./lib.mjs";

const SR = 44100, ID = 883921, KEY = "claim-key", SECS = 12;
const FMT2 = { sampleRate: SR, channels: 2 };

const mono0 = synthesizeSpeechLike({ seconds: SECS, sampleRate: SR, channels: 1, seed: "claims" });
const clean = new Float32Array(mono0.length * 2);
for (let i = 0; i < mono0.length; i++) { clean[i * 2] = mono0[i]; clean[i * 2 + 1] = mono0[i]; }
const marked = embedWatermark(clean, FMT2, { payloadId: ID, key: KEY });
const baseline = detectWatermark(marked, FMT2, { payloadId: ID, key: KEY });
console.log(`baseline: detected=${baseline.detected} conf=${baseline.confidence.toFixed(2)} snr=${snrDb(clean, marked).toFixed(1)}dB`);
const ctl = detectWatermark(clean, FMT2, { payloadId: ID, key: KEY });
console.log(`control (unmarked): detected=${ctl.detected} conf=${ctl.confidence.toFixed(2)}\n`);

const rows = [];
function run(claim, expect, label, fn, src = marked) {
  let t;
  try { t = fn(src); } catch (e) { rows.push({ claim, label, expect, got: "ERR", ok: false, err: e.message }); return; }
  const { pcm, fmt } = t;
  let r;
  try { r = detectWatermark(pcm, fmt, { payloadId: ID, key: KEY }); }
  catch (e) { rows.push({ claim, label, expect, got: "detectErr", ok: false, err: e.message }); return; }
  const ok = r.detected === expect && (!expect || r.recoveredPayloadId === ID);
  rows.push({ claim, label, expect, got: r.detected, id: r.recoveredPayloadId, conf: +r.confidence.toFixed(2), ok });
}
const deint = (pcm, ch = 2) => { const n = pcm.length / ch, o = Array.from({ length: ch }, () => new Float32Array(n)); for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) o[c][i] = pcm[i * ch + c]; return o; };
const inter = (chs) => { const n = chs[0].length, ch = chs.length, o = new Float32Array(n * ch); for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) o[i * ch + c] = chs[c][i]; return o; };
const stereo = (fn) => (pcm) => { const [L, R] = deint(pcm); const [a, b] = fn(L, R); return { pcm: inter([a, b]), fmt: FMT2 }; };
const toMono = (fn) => (pcm) => { const [L, R] = deint(pcm); return { pcm: fn(L, R), fmt: { sampleRate: SR, channels: 1 } }; };

// RBJ biquad LP/HP, cascaded N times (approximates high-order filter)
function biquadLP(x, hz, q) {
  const w0 = 2 * Math.PI * hz / SR, c = Math.cos(w0), s = Math.sin(w0), al = s / (2 * q);
  const b0 = (1 - c) / 2, b1 = 1 - c, b2 = (1 - c) / 2, a0 = 1 + al, a1 = -2 * c, a2 = 1 - al;
  const o = new Float32Array(x.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) { const y = (b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0; x2 = x1; x1 = x[i]; y2 = y1; y1 = y; o[i] = y; }
  return o;
}
function biquadHP(x, hz, q) {
  const w0 = 2 * Math.PI * hz / SR, c = Math.cos(w0), s = Math.sin(w0), al = s / (2 * q);
  const b0 = (1 + c) / 2, b1 = -(1 + c), b2 = (1 + c) / 2, a0 = 1 + al, a1 = -2 * c, a2 = 1 - al;
  const o = new Float32Array(x.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) { const y = (b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0; x2 = x1; x1 = x[i]; y2 = y1; y1 = y; o[i] = y; }
  return o;
}
const cascade = (fn, n) => (x) => { let y = x; for (let i = 0; i < n; i++) y = fn(y); return y; };
const lpf = (hz) => stereo((L, R) => [cascade((x) => biquadLP(x, hz, 0.7071), 4)(L), cascade((x) => biquadLP(x, hz, 0.7071), 4)(R)]);
const hpf = (hz) => stereo((L, R) => [cascade((x) => biquadHP(x, hz, 0.7071), 4)(L), cascade((x) => biquadHP(x, hz, 0.7071), 4)(R)]);
function notch(x, hz, q = 8) {
  const w0 = 2 * Math.PI * hz / SR, c = Math.cos(w0), al = Math.sin(w0) / (2 * q);
  const b0 = 1, b1 = -2 * c, b2 = 1, a0 = 1 + al, a1 = -2 * c, a2 = 1 - al;
  const o = new Float32Array(x.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) { const y = (b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0; x2 = x1; x1 = x[i]; y2 = y1; y1 = y; o[i] = y; }
  return o;
}

// 1) M/S
run("Mid/Side Subtraction (L-R)", true, "L-R delivered as mono", toMono((L, R) => { const d = new Float32Array(L.length); for (let i = 0; i < L.length; i++) d[i] = (L[i] - R[i]) / Math.SQRT2; return d; }));
run("Mid/Side Subtraction (L-R)", true, "L-R in left channel only", stereo((L, R) => { const d = new Float32Array(L.length); for (let i = 0; i < L.length; i++) d[i] = (L[i] - R[i]) / Math.SQRT2; return [d, new Float32Array(d.length)]; }));
run("Mid/Side Subtraction (L-R)", true, "original (L-R)/sqrt2, then stereo dup", toMono((L, R) => { const d = new Float32Array(L.length); for (let i = 0; i < L.length; i++) d[i] = (L[i] - R[i]) / Math.SQRT2; return d; }));
// 2) phase inversion
run("Phase-Inversion Downmix", true, "L+(-R) as mono", toMono((L, R) => { const d = new Float32Array(L.length); for (let i = 0; i < L.length; i++) d[i] = (L[i] - R[i]) / 2; return d; }));
// 3) stereo->mono
run("Stereo-to-Mono downmix", true, "mono downmix", toMono((L, R) => { const d = new Float32Array(L.length); for (let i = 0; i < L.length; i++) d[i] = (L[i] + R[i]) / 2; return d; }));
// 4) crop
const crop = (secs, from = 0) => (pcm) => ({ pcm: pcm.subarray(Math.floor(from * SR) * 2, Math.min(Math.floor((from + secs) * SR) * 2, pcm.length)), fmt: FMT2 });
run("Short snippet crop (1.8s)", true, "first 1.8 s", crop(1.8));
run("Short snippet crop (1.8s)", true, "1.8 s from 4.3 s", crop(1.8, 4.3));
run("Short snippet crop (1.8s)", true, "1.8 s at 0.37 s (unaligned)", crop(1.8, 0.37));
run("Short snippet crop (1.8s)", true, "1.8 s at 5.11 s (unaligned)", crop(1.8, 5.11));
// 5) speed/pitch
for (const f of [1.01, 1.005, 0.995, 0.99]) {
  const rate = Math.round(SR * f);
  run("Playback speed ±1.0%", f !== 1 && (f === 1.01 || f === 0.99), `resampled ${f}x`, (pcm) => ({ pcm: resamplePcm(pcm, 2, SR, rate), fmt: { sampleRate: rate, channels: 2 } }));
}
// 6) low-pass
run("Low-pass 16 kHz", true, "16 kHz LPF (dual band)", lpf(16000));
run("Low-pass 12 kHz", false, "12 kHz LPF (dual band)", lpf(12000));
run("Low-pass 7 kHz", false, "7 kHz LPF (dual band)", lpf(7000));
{
  const hi = embedWatermark(clean, FMT2, { payloadId: ID, key: KEY, band: "high" });
  for (const hz of [16000, 12000, 7000]) {
    const t = lpf(hz)(hi);
    const r = detectWatermark(t.pcm, t.fmt, { payloadId: ID, key: KEY, band: "high" });
    rows.push({ claim: "Low-pass, high-band-only watermark", label: `${hz / 1000} kHz LPF`, expect: hz >= 16000, got: r.detected, id: r.recoveredPayloadId, conf: +r.confidence.toFixed(2), ok: hz >= 16000 ? r.detected : !r.detected });
  }
}
// 7) high-pass / notch
run("High-pass 1 kHz", true, "1 kHz HPF", hpf(1000));
run("Notch 18 kHz", true, "18 kHz notch", stereo((L, R) => [notch(L, 18000), notch(R, 18000)]));
// 8) reverb (Schroeder: 4 combs + 2 allpass)
function schroeder(x) {
  const combs = [1557, 1617, 1491, 1422].map((d) => ({ d: Math.round(d * SR / 44100), buf: new Float32Array(Math.round(d * SR / 44100)), idx: 0, g: 0.78 }));
  const aps = [225, 556].map((d) => ({ d: Math.round(d * SR / 44100), buf: new Float32Array(Math.round(d * SR / 44100)), idx: 0, g: 0.5 }));
  const o = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    let s = 0;
    for (const c of combs) { const y = c.buf[c.idx]; s += y; c.buf[c.idx] = x[i] * 0.25 + y * c.g; c.idx = (c.idx + 1) % c.d; }
    let a = s;
    for (const p of aps) { const y = p.buf[p.idx]; const v = a + y * p.g; p.buf[p.idx] = v; p.idx = (p.idx + 1) % p.d; a = y - v * p.g; }
    o[i] = a;
  }
  return o;
}
run("Air-gap recording (reverb)", true, "Schroeder room reverb + dry", stereo((L, R) => { const a = schroeder(L), b = schroeder(R); for (let i = 0; i < a.length; i++) { a[i] = a[i] * 0.6 + L[i]; b[i] = b[i] * 0.6 + R[i]; } return [a, b]; }));
// 9) +12 dB clip
run("Extreme overdrive +12 dB", true, "+12 dB hard clip", stereo((L, R) => { const g = Math.pow(10, 12 / 20); return [L.map((v) => Math.max(-1, Math.min(1, v * g))), R.map((v) => Math.max(-1, Math.min(1, v * g)))]; }));
// 10) limiter
run("Broadcast compression/limiting", true, "20:1 limiter @ -6 dBFS", stereo((L, R) => {
  const a = new Float32Array(L.length), b = new Float32Array(R.length);
  const atk = Math.exp(-1 / (SR * 0.003)), rel = Math.exp(-1 / (SR * 0.08));
  let gain = 1; const thr = 0.5, ratio = 20;
  for (let i = 0; i < L.length; i++) {
    const peak = Math.max(Math.abs(L[i]), Math.abs(R[i]));
    let target = 1;
    if (peak > thr) { const over = 20 * Math.log10(peak / thr); target = Math.pow(10, -(over - over / ratio) / 20); }
    gain = target < gain ? atk * gain + (1 - atk) * target : rel * gain + (1 - rel) * target;
    a[i] = L[i] * gain; b[i] = R[i] * gain;
  }
  return [a, b];
}));
// 11) -20 dB noise
run("Additive noise -20 dB SNR", true, "pink noise -20 dB", (pcm) => {
  const nz = pinkNoise(pcm.length, "room");
  let sp = 0, sn = 0; for (let i = 0; i < pcm.length; i++) { sp += pcm[i] * pcm[i]; sn += nz[i] * nz[i]; }
  const g = (Math.sqrt(sp / pcm.length) / Math.sqrt(10)) / Math.sqrt(sn / nz.length);
  const o = new Float32Array(pcm.length); for (let i = 0; i < pcm.length; i++) o[i] = pcm[i] + nz[i] * g;
  return { pcm: o, fmt: FMT2 };
});
// 12) SARC
for (const rate of [48000, 32000, 22050, 16000, 96000]) {
  run("Sample-rate conversion", true, `44.1k -> ${rate}`, (pcm) => ({ pcm: resamplePcm(pcm, 2, SR, rate), fmt: { sampleRate: rate, channels: 2 } }));
}

console.log("STAT  " + "CLAIM".padEnd(38) + "VARIANT".padEnd(34) + "DETECT  ID");
let fails = 0;
for (const r of rows) {
  const ok = r.ok !== false;
  if (!ok) fails++;
  console.log(`${ok ? "OK  " : "FAIL"}  ${r.claim.padEnd(36)} ${String(r.label).padEnd(32)} ${String(r.got).padEnd(6)} ${r.id ?? "-"}${r.err ? "  " + r.err : ""}`);
}
console.log(`\n${fails} of ${rows.length} claim checks not met`);
