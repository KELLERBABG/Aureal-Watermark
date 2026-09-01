// embed.js — spread-spectrum watermark embedder.
//
// The 32-bit payload id + 16-bit CRC form a 48-symbol BPSK codeword. Each
// symbol is carried by its own pseudorandom ±1 chip sequence shaped onto an
// inaudible carrier near 18 kHz (Hann-windowed bursts => energy confined to
// ~16.5–19.5 kHz). One repetition of the codeword occupies `frameLen`
// samples (~1 s); the template repeats for the whole track, so detection
// gains coherent integration over every second of audio.

import {
  deriveGeometry,
  buildTemplate,
  bandList,
} from "./signal.js";
import { packCodeword } from "./payload.js";

const DEFAULT_KEY = "aural-watermark-default-key";
const MAX_AMPLITUDE = 0.12; // never exceed ~-18 dBFS watermark peak
// When embedding in several bands simultaneously, scale each copy so the
// combined peak stays comparable to a single-band embed.
const MULTI_BAND_SCALE = 0.7;

/**
 * Embed a watermark into interleaved float PCM.
 *
 * @param {Float32Array|number[]} pcm interleaved samples in [-1, 1]
 * @param {{sampleRate:number, channels:number}} fmt
 * @param {object} opts
 * @param {number} opts.payloadId uint32 id to embed (required)
 * @param {string} [opts.key] secret key selecting the PN sequences
 * @param {number} [opts.strength] 0..1 perceptual strength, default 0.5
 * @param {{lowHz?:number, highHz?:number}} [opts.band] target band override
 * @returns {Float32Array} new array = input + watermark (input untouched)
 */
export function embedWatermark(pcm, fmt, opts) {
  if (!opts || !Number.isInteger(opts.payloadId)) {
    throw new TypeError("embedWatermark requires opts.payloadId as an integer");
  }
  const { sampleRate, channels } = validateFmt(fmt, pcm.length);
  const key = typeof opts.key === "string" && opts.key.length ? opts.key : DEFAULT_KEY;
  const bands = bandList(opts.band, sampleRate);

  let strength = Number.isFinite(opts.strength) ? Math.min(1, Math.max(0.01, opts.strength)) : 0.5;
  // Map user strength linearly to peak amplitude: 1.0 -> -18 dBFS, 0.5 -> -24 dBFS.
  const amp =
    Math.min(MAX_AMPLITUDE, Math.max(0.001, strength) * MAX_AMPLITUDE) *
    (bands.length > 1 ? MULTI_BAND_SCALE : 1);

  const perChannel = pcm.length / channels;
  const geometry = deriveGeometry(sampleRate, perChannel);
  const codeword = packCodeword(opts.payloadId);
  const { slotLen, frameLen, reps, bits } = geometry;

  // One frame of the final watermark signal (identical on every channel, so
  // a mono downmix of stereo content keeps the watermark). For multi-band
  // specs ("dual") the same codeword is embedded in every band; each band's
  // template uses the same keyed PN symbols, so one key verifies both.
  const wm = new Float64Array(frameLen);
  let peakDelta = 0;
  const bandPeaks = [];
  for (const band of bands) {
    const built = buildTemplate({ key, sampleRate, geometry, band });
    const { template } = built;

    for (let b = 0; b < bits; b++) {
      const s = codeword[b];
      const off = b * slotLen;
      for (let n = 0; n < slotLen; n++) {
        wm[off + n] += amp * s * template[off + n];
      }
    }
  }
  for (let n = 0; n < frameLen; n++) peakDelta = Math.max(peakDelta, Math.abs(wm[n]));

  const out = new Float32Array(pcm.length);
  out.set(pcm);

  for (let r = 0; r < reps; r++) {
    const base = r * frameLen * channels;
    for (let ch = 0; ch < channels; ch++) {
      let o = base + ch;
      for (let n = 0; n < frameLen; n++) {
        out[o] = out[o] + wm[n];
        o += channels;
      }
    }
  }

  return attachMeta(out, {
    payloadId: opts.payloadId >>> 0,
    key,
    strength,
    amplitude: amp,
    peakWatermark: peakDelta,
    band: bands.length > 1 ? "dual" : bands[0],
    bands,
    geometry: { slotLen, chipLen: geometry.chipLen, frameLen, reps, bits },
  });
}

function attachMeta(arr, meta) {
  Object.defineProperty(arr, "watermarkMeta", { value: meta, enumerable: false });
  return arr;
}

export function validateFmt(fmt, totalSamples) {
  if (!fmt) throw new TypeError("format object required: {sampleRate, channels}");
  const { sampleRate, channels } = fmt;
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 768000) {
    throw new RangeError(`unsupported sampleRate ${sampleRate}`);
  }
  if (!Number.isInteger(channels) || channels < 1 || channels > 8) {
    throw new RangeError(`unsupported channel count ${channels}`);
  }
  if (totalSamples % channels !== 0) {
    throw new RangeError(`pcm length ${totalSamples} not divisible by ${channels} channels`);
  }
  return { sampleRate, channels };
}
