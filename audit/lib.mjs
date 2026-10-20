// Audit helpers: deterministic synthetic signal generators.
import { makeRng } from "../src/signal.js";

export function whiteNoise(n, seed = "n", peak = 0.5) {
  const rng = makeRng(seed);
  const out = new Float32Array(n);
  let mx = 0;
  for (let i = 0; i < n; i++) { out[i] = rng() * 2 - 1; mx = Math.max(mx, Math.abs(out[i])); }
  for (let i = 0; i < n; i++) out[i] *= peak / mx;
  return out;
}

export function pinkNoise(n, seed = "p", peak = 0.5) {
  const rng = makeRng(seed);
  const out = new Float32Array(n);
  let b0 = 0, b1 = 0, b2 = 0, mx = 0;
  for (let i = 0; i < n; i++) {
    const w = rng() * 2 - 1;
    b0 = 0.99765 * b0 + w * 0.099046;
    b1 = 0.963 * b1 + w * 0.2965164;
    b2 = 0.57 * b2 + w * 1.0526913;
    const v = b0 + b1 + b2 + w * 0.1848;
    out[i] = v;
    mx = Math.max(mx, Math.abs(v));
  }
  for (let i = 0; i < n; i++) out[i] *= peak / mx;
  return out;
}

export function sine(n, sr, hz = 1000, peak = 0.5) {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = peak * Math.sin((2 * Math.PI * hz * i) / sr);
  return out;
}

export function silence(n) { return new Float32Array(n); }

// Broadband "music-like" signal with energy across the whole spectrum incl. watermark bands.
export function broadband(n, sr, seed = "bb", peak = 0.5) {
  const rng = makeRng(seed);
  const out = new Float32Array(n);
  const partials = [];
  for (let k = 0; k < 220; k++) {
    const f = 40 * Math.pow(1.03, k) * (0.7 + rng() * 0.6);
    if (f > sr * 0.48) break;
    partials.push({ f, a: (0.15 + rng()) / Math.sqrt(f / 200 + 1), p: rng() * Math.PI * 2 });
  }
  let mx = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    let v = 0;
    for (const { f, a, p } of partials) v += a * Math.sin(2 * Math.PI * f * t + p);
    // slow amplitude movement
    v *= 0.75 + 0.25 * Math.sin(2 * Math.PI * 0.23 * t);
    out[i] = v;
    mx = Math.max(mx, Math.abs(v));
  }
  for (let i = 0; i < n; i++) out[i] *= peak / mx;
  return out;
}

export function stereo(mono, channels = 2, seed = "s", width = 0.9) {
  const n = mono.length;
  const out = new Float32Array(n * channels);
  const rng = makeRng(seed);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < channels; c++) {
      const jitter = c === 0 ? 1 : width * (0.6 + 0.4 * rng());
      out[i * channels + c] = mono[i] * jitter;
    }
  }
  return out;
}

export function fmt(sampleRate, channels) { return { sampleRate, channels }; }

export function snrDb(ref, test) {
  let s = 0, n = 0;
  const len = Math.min(ref.length, test.length);
  for (let i = 0; i < len; i++) { const d = ref[i] - test[i]; s += d * d; n += ref[i] * ref[i]; }
  return n > 0 ? 10 * Math.log10(n / Math.max(s, 1e-20)) : -Infinity;
}
