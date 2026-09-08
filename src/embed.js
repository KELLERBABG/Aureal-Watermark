import {
  deriveGeometry,
  buildTemplate,
  buildSyncPreamble,
  bandList,
} from "./signal.js";
import { packCodeword } from "./payload.js";

const DEFAULT_KEY = "aural-watermark-default-key";
const MAX_AMPLITUDE = 0.0075;
const MULTI_BAND_SCALE = 0.7;
const MID_BAND_PERCEPTUAL_WEIGHT = 0.22;

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

  let peakDelta = 0;
  const wmMid = synthesizeWatermarkFrame({ key, sampleRate, geometry, bands, codeword, amp });
  const wmSide = channels >= 2
    ? synthesizeWatermarkFrame({ key: key + "|side", sampleRate, geometry, bands, codeword, amp })
    : null;

  const SQRT2_INV = 1 / Math.SQRT2;
  const wmLeft = channels >= 2 ? new Float64Array(frameLen) : wmMid;
  const wmRight = channels >= 2 ? new Float64Array(frameLen) : wmMid;
  if (channels >= 2) {
    for (let n = 0; n < frameLen; n++) {
      wmLeft[n] = (wmMid[n] + wmSide[n]) * SQRT2_INV;
      wmRight[n] = (wmMid[n] - wmSide[n]) * SQRT2_INV;
      peakDelta = Math.max(peakDelta, Math.abs(wmLeft[n]), Math.abs(wmRight[n]));
    }
  } else {
    for (let n = 0; n < frameLen; n++) peakDelta = Math.max(peakDelta, Math.abs(wmMid[n]));
  }

  const out = new Float32Array(pcm.length);
  out.set(pcm);

  for (let r = 0; r < reps; r++) {
    const base = r * frameLen * channels;
    for (let ch = 0; ch < channels; ch++) {
      const channelWm = ch === 0 ? wmLeft : (ch === 1 ? wmRight : wmMid);
      for (let b = 0; b < bits; b++) {
        const slotOffset = base + ch + b * slotLen * channels;
        // Compute slot RMS for psychoacoustic masking
        let sumSq = 0;
        for (let n = 0; n < slotLen; n++) {
          const s = pcm[slotOffset + n * channels];
          sumSq += s * s;
        }
        const rms = Math.sqrt(sumSq / slotLen);
        // Adaptive proportional masking:
        // Mute in near-silence (<= -54 dBFS) to preserve clean pauses/breakdowns.
        // In audible sections, scale watermark proportionally to local host RMS,
        // keeping watermark >= 32-36 dB below the music, capped at 1.0.
        const mask = rms <= 0.002 ? 0.0 : Math.min(1.0, (rms - 0.002) / 0.08);
        if (mask > 0) {
          const wmSlotBase = b * slotLen;
          let o = slotOffset;
          for (let n = 0; n < slotLen; n++) {
            out[o] += channelWm[wmSlotBase + n] * mask;
            o += channels;
          }
        }
      }
    }
  }

  // Headroom protection & soft-peak limiting (prevent digital clipping when peak > 0.999)
  let maxPeak = 0;
  for (let i = 0; i < out.length; i++) {
    const abs = Math.abs(out[i]);
    if (abs > maxPeak) maxPeak = abs;
  }
  if (maxPeak > 0.999) {
    const headroomScale = 0.995 / maxPeak;
    for (let i = 0; i < out.length; i++) {
      out[i] *= headroomScale;
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

function synthesizeWatermarkFrame({ key, sampleRate, geometry, bands, codeword, amp }) {
  const { slotLen, frameLen, bits } = geometry;
  const wm = new Float64Array(frameLen);
  for (const band of bands) {
    const isMid = band.lowHz < 14000;
    const bandAmp = amp * (isMid ? MID_BAND_PERCEPTUAL_WEIGHT : 1.0);
    const built = buildTemplate({ key, sampleRate, geometry, band });
    const { template } = built;
    for (let b = 0; b < bits; b++) {
      const s = codeword[b];
      const off = b * slotLen;
      for (let n = 0; n < slotLen; n++) {
        wm[off + n] += bandAmp * s * template[off + n];
      }
    }
    const { chirpQ, syncLen } = buildSyncPreamble({ key, sampleRate, geometry, band });
    const chirpScale = isMid ? 0.25 : 0.75;
    for (let n = 0; n < syncLen; n++) {
      wm[n] += bandAmp * chirpScale * chirpQ[n];
    }
  }
  return wm;
}

