import {
  deriveGeometry,
  buildTemplate,
  bandList,
} from "./signal.js";
import { packCodeword } from "./payload.js";

const DEFAULT_KEY = "aural-watermark-default-key";
const MAX_AMPLITUDE = 0.12;
const MULTI_BAND_SCALE = 0.7;

export function embedWatermark(pcm, fmt, opts) {
  if (!opts || !Number.isInteger(opts.payloadId)) {
    throw new TypeError("embedWatermark requires opts.payloadId as an integer");
  }
  const { sampleRate, channels } = validateFmt(fmt, pcm.length);
  const key = typeof opts.key === "string" && opts.key.length ? opts.key : DEFAULT_KEY;
  const bands = bandList(opts.band, sampleRate);

  let strength = Number.isFinite(opts.strength) ? Math.min(1, Math.max(0.01, opts.strength)) : 0.5;
  const amp =
    Math.min(MAX_AMPLITUDE, Math.max(0.001, strength) * MAX_AMPLITUDE) *
    (bands.length > 1 ? MULTI_BAND_SCALE : 1);

  const perChannel = pcm.length / channels;
  const geometry = deriveGeometry(sampleRate, perChannel);
  const codeword = packCodeword(opts.payloadId);
  const { slotLen, frameLen, reps, bits } = geometry;

  const wm = new Float64Array(frameLen);
  let peakDelta = 0;
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
