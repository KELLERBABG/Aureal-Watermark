// synth.js — deterministic speech-like test signal generator.
// Harmonic stack with formant-ish weighting, vibrato, syllabic AM gating and
// a touch of breath noise. All energy stays well below 12 kHz so demos do
// not pollute the watermark band.

import { makeRng } from "./signal.js";

/**
 * @param {{seconds?:number, sampleRate?:number, channels?:number, seed?:string,
 *          peak?:number}} opts
 * @returns {Float32Array} interleaved samples
 */
export function synthesizeSpeechLike(opts = {}) {
  const seconds = Math.max(0.1, Number(opts.seconds ?? 10));
  const sampleRate = Math.round(opts.sampleRate ?? 44100);
  const channels = Math.max(1, Math.min(8, Math.round(opts.channels ?? 1)));
  const peak = Math.min(0.95, Math.max(0.05, opts.peak ?? 0.5));
  const rng = makeRng("aural-synth|" + (opts.seed ?? "seed"));

  const f0Base = 110 + rng() * 60; // male-to-female-ish pitch
  const vibRate = 4 + rng() * 2;
  const syllRate = 2.5 + rng() * 1.5;
  const phase0 = rng() * Math.PI * 2;

  const nFrames = Math.round(seconds * sampleRate);
  const mono = new Float32Array(nFrames);

  const F1 = 500 + rng() * 300;
  const F2 = 1200 + rng() * 400;
  const F3 = 2400 + rng() * 600;

  // Precompute per-harmonic amplitude (formant weighting), cap at < 11 kHz.
  const harmF = [];
  const harmA = [];
  for (let h = 1; ; h++) {
    const f = f0Base * h;
    if (f >= Math.min(11000, sampleRate * 0.42)) break;
    const g = (fc, bw) => Math.exp(-((f - fc) ** 2) / (2 * bw * bw));
    const formant = 1 + 3.5 * g(F1, 120) + 2.2 * g(F2, 180) + 1.2 * g(F3, 260);
    harmF.push(f);
    harmA.push(formant / Math.pow(h, 1.15));
  }

  // breath noise state (one-pole lowpass)
  let lp = 0;
  const lpCoef = Math.exp((-2 * Math.PI * 900) / sampleRate);

  let sumSq = 0;
  for (let i = 0; i < nFrames; i++) {
    const t = i / sampleRate;
    const f0 =
      f0Base *
      (1 +
        0.03 * Math.sin(2 * Math.PI * vibRate * t + phase0) +
        0.02 * Math.sin(2 * Math.PI * 0.31 * t));
    let v = 0;
    for (let k = 0; k < harmF.length; k++) {
      v += harmA[k] * Math.sin((2 * Math.PI * harmF[k] * t) % (2 * Math.PI) + 0.13 * k);
    }
    // syllabic AM: raised-cosine syllables with occasional pauses
    const gate = 0.5 - 0.5 * Math.cos(2 * Math.PI * syllRate * t + phase0);
    const pause = Math.sin(2 * Math.PI * 0.37 * t) > 0.75 ? 0.15 : 1;
    const env = (0.18 + 0.82 * gate) * pause;
    lp = lpCoef * lp + (1 - lpCoef) * (rng() * 2 - 1);
    v = env * v + 0.06 * env * lp;
    mono[i] = v;
    sumSq += v * v;
  }

  // normalize to target peak
  let maxAbs = 0;
  for (let i = 0; i < nFrames; i++) maxAbs = Math.max(maxAbs, Math.abs(mono[i]));
  const scale = maxAbs > 0 ? peak / maxAbs : 1;
  void sumSq;

  if (channels === 1) {
    for (let i = 0; i < nFrames; i++) mono[i] *= scale;
    return mono;
  }
  const out = new Float32Array(nFrames * channels);
  for (let i = 0; i < nFrames; i++) {
    const s = mono[i] * scale;
    for (let ch = 0; ch < channels; ch++) out[i * channels + ch] = s;
  }
  return out;
}
