// detect.js — watermark detection & verification.
//
// Modes:
//  * verify (payloadId given): matched filter against the expected codeword.
//  * blind/open (no payloadId): correlate all 48 PN slots, hard-decide each
//    bit, validate CRC16; a single-bit error is corrected via reliability
//    ordered flips.
//
// Band specs ("high", "mid", object) run one band. "dual"/"auto" try both
// presets and return the best-scoring result (details.bandUsed says which).
// A coarse resync grid absorbs small sample shifts introduced by lossy
// decode pipelines. Statistics are scale invariant: gain changes do not
// affect the result.

import {
  deriveGeometry,
  buildTemplate,
  bandList,
  BITS_PER_CODEWORD,
} from "./signal.js";
import { packCodeword, unpackCodeword, isValidPayloadId } from "./payload.js";
import { validateFmt } from "./embed.js";

const DEFAULT_KEY = "aural-watermark-default-key";
const Z_FLOOR = 3.0; // z below this => confidence 0
const Z_FULL = 30.0; // z at/above this => confidence 1

// Coarse resync offsets (fractions of the frame length). Lossy decode or
// trimming can shift sample alignment slightly; a small offset grid restores
// correlation without a full cross-correlation search.
const RESYNC_FRACTIONS = [0, 1 / 16, 2 / 16, 4 / 16, -1 / 16, -2 / 16, -4 / 16];

function foldRepetitions(pcm, channels, frameLen, startOffset, usableSamples) {
  const folded = new Float64Array(frameLen);
  let count = 0;
  for (
    let base = startOffset;
    base + frameLen <= usableSamples;
    base += frameLen
  ) {
    let idx = base * channels;
    for (let n = 0; n < frameLen; n++) {
      let acc = 0;
      for (let ch = 0; ch < channels; ch++) acc += pcm[idx + ch];
      folded[n] += acc;
      idx += channels;
    }
    count++;
  }
  return { folded, reps: count };
}

/** Score one (band, offset) hypothesis. Returns null if unusable. */
function scoreHypothesis(pcm, fmt, { key, payloadId, sampleRate, band }) {
  const { channels } = fmt;
  const perChannel = Math.floor(pcm.length / channels);
  const geometry = deriveGeometry(sampleRate, perChannel);
  const { slotLen, frameLen } = geometry;

  const maxShift = Math.floor(frameLen / 4);
  const candidates = [];
  for (const f of RESYNC_FRACTIONS) {
    const shift = Math.round(f * frameLen);
    const clamped = Math.max(0, Math.min(maxShift, shift));
    if (!candidates.some((c) => c.shift === clamped)) candidates.push({ shift: clamped });
  }

  let best = null;
  for (const { shift } of candidates) {
    const usable = perChannel - shift;
    const { folded, reps } = foldRepetitions(
      pcm,
      channels,
      frameLen,
      shift,
      perChannel
    );
    if (reps < 1 || usable < frameLen) continue;

    const { template, slotNorms } = buildTemplate({
      key,
      sampleRate,
      geometry,
      band,
    });

    const soft = new Float64Array(BITS_PER_CODEWORD);
    for (let b = 0; b < BITS_PER_CODEWORD; b++) {
      let dot = 0;
      const off = b * slotLen;
      for (let n = 0; n < slotLen; n++) dot += folded[off + n] * template[off + n];
      soft[b] = dot / (reps * channels * slotNorms[b]);
    }

    let hard = new Int8Array(BITS_PER_CODEWORD);
    for (let b = 0; b < BITS_PER_CODEWORD; b++) hard[b] = soft[b] >= 0 ? 1 : -1;

    const absSorted = [...soft].map((v, i) => [Math.abs(v), i]).sort((a, b) => a[0] - b[0]);
    let decoded = unpackCodeword(hard);
    let correctedAt = -1;
    if (!decoded.crcOk) {
      for (const [, i] of absSorted) {
        const trial = Int8Array.from(hard);
        trial[i] = -trial[i];
        const t = unpackCodeword(trial);
        if (t.crcOk) {
          hard = trial;
          decoded = t;
          correctedAt = i;
          break;
        }
      }
    }

    const refBits =
      payloadId !== undefined ? packCodeword(payloadId) : hard;
    let mu = 0;
    let berCount = 0;
    for (let b = 0; b < BITS_PER_CODEWORD; b++) {
      mu += soft[b] * refBits[b];
      if ((hard[b] > 0) !== (refBits[b] > 0)) berCount++;
    }
    mu /= BITS_PER_CODEWORD;
    let varAcc = 0;
    let maxAbs = 0;
    for (let b = 0; b < BITS_PER_CODEWORD; b++) {
      const a = soft[b] * refBits[b] - mu;
      varAcc += a * a;
      maxAbs = Math.max(maxAbs, Math.abs(soft[b]));
    }
    const sd = Math.sqrt(varAcc / BITS_PER_CODEWORD);
    const denom = sd / Math.sqrt(BITS_PER_CODEWORD) + 1e-3 * maxAbs + 1e-12;
    const z = mu / denom;
    const confidence = Math.min(1, Math.max(0, (z - Z_FLOOR) / (Z_FULL - Z_FLOOR)));

    if (!best || confidence > best.confidence) {
      best = {
        soft,
        hard,
        decoded,
        correctedAt,
        mu,
        sd,
        z,
        confidence,
        ber: berCount / BITS_PER_CODEWORD,
        reps,
        shiftUsed: shift,
      };
    }
  }
  return best;
}

/**
 * Detect / verify a watermark.
 *
 * @param {Float32Array|number[]} pcm interleaved samples
 * @param {{sampleRate:number, channels:number}} fmt
 * @param {object} opts
 * @param {string} [opts.key] secret key used at embed time
 * @param {number} [opts.payloadId] expected id (verify mode) — omit for blind
 * @param {string|object} [opts.band] "high"|"mid"|"dual"|"auto" or {lowHz,highHz}
 * @returns {{detected:boolean, confidence:number, ber:number,
 *            recoveredPayloadId:number|null, crcOk:boolean, reps:number,
 *            amplitude:number, details:object}}
 */
export function detectWatermark(pcm, fmt, opts = {}) {
  const validated = validateFmt(fmt, pcm.length);
  const key = typeof opts.key === "string" && opts.key.length ? opts.key : DEFAULT_KEY;
  if (opts.payloadId !== undefined && !isValidPayloadId(opts.payloadId)) {
    throw new TypeError(`bad payloadId ${opts.payloadId}`);
  }

  const bands = bandList(opts.band, validated.sampleRate);
  let winner = null;
  let winnerBand = null;
  for (const band of bands) {
    const r = scoreHypothesis(pcm, validated, {
      key,
      payloadId: opts.payloadId,
      sampleRate: validated.sampleRate,
      band,
    });
    if (r && (!winner || r.confidence > winner.confidence)) {
      winner = r;
      winnerBand = band;
    }
  }

  if (!winner) {
    throw new RangeError("audio too short for watermarking at this sample rate");
  }

  const idMatches =
    opts.payloadId === undefined || winner.decoded.id === opts.payloadId;
  const detected =
    winner.decoded.crcOk && idMatches && winner.confidence >= 0.5 && winner.mu > 0;

  return {
    detected,
    confidence: winner.confidence,
    ber: winner.ber,
    recoveredPayloadId: winner.decoded.crcOk ? winner.decoded.id : null,
    crcOk: winner.decoded.crcOk,
    reps: winner.reps,
    amplitude: winner.mu,
    details: {
      mode: opts.payloadId !== undefined ? "verify" : "blind",
      z: winner.z,
      meanAlignedAmplitude: winner.mu,
      amplitudeSpread: winner.sd,
      singleBitCorrected: winner.correctedAt >= 0 ? winner.correctedAt : null,
      band: bands.length > 1 ? opts.band : winnerBand,
      bandUsed: winnerBand,
      bandsTried: bands.length,
      resyncShiftSamples: winner.shiftUsed,
      sampleRate: validated.sampleRate,
      channels: validated.channels,
      perChannelSamples: Math.floor(pcm.length / validated.channels),
      bits: BITS_PER_CODEWORD,
    },
  };
}
