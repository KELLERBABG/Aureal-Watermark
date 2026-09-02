import {
  deriveGeometry,
  buildTemplate,
  buildSyncPreamble,
  bandList,
  BITS_PER_CODEWORD,
} from "./signal.js";
import { packCodeword, unpackCodeword, isValidPayloadId } from "./payload.js";
import { validateFmt } from "./embed.js";
import { resamplePcm } from "./resample.js";

const DEFAULT_KEY = "aural-watermark-default-key";
const Z_FLOOR = 3.0;
const Z_FULL = 30.0;
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

function findPreambleOffsets(pcm, channels, sampleRate, geometry, key, band) {
  const { frameLen } = geometry;
  const { chirpI, chirpQ, syncLen, norm } = buildSyncPreamble({ key, sampleRate, geometry, band });
  const perChannel = Math.floor(pcm.length / channels);
  const searchLen = Math.min(frameLen, perChannel - syncLen);
  if (searchLen <= 0) return [];

  const mono = new Float32Array(searchLen + syncLen);
  for (let i = 0; i < searchLen + syncLen; i++) {
    let sum = 0;
    for (let ch = 0; ch < channels; ch++) sum += pcm[i * channels + ch];
    mono[i] = sum / channels;
  }

  const stride = 8;
  let maxEnvSq = -Infinity;
  let coarseIdx = 0;

  for (let i = 0; i < searchLen; i += stride) {
    let dotI = 0, dotQ = 0;
    for (let k = 0; k < syncLen; k++) {
      const s = mono[i + k];
      dotI += s * chirpI[k];
      dotQ += s * chirpQ[k];
    }
    const envSq = dotI * dotI + dotQ * dotQ;
    if (envSq > maxEnvSq) {
      maxEnvSq = envSq;
      coarseIdx = i;
    }
  }

  let fineIdx = coarseIdx;
  let fineMaxEnvSq = maxEnvSq;
  const fineStart = Math.max(0, coarseIdx - stride * 2);
  const fineEnd = Math.min(searchLen - 1, coarseIdx + stride * 2);

  for (let i = fineStart; i <= fineEnd; i++) {
    let dotI = 0, dotQ = 0;
    for (let k = 0; k < syncLen; k++) {
      const s = mono[i + k];
      dotI += s * chirpI[k];
      dotQ += s * chirpQ[k];
    }
    const envSq = dotI * dotI + dotQ * dotQ;
    if (envSq > fineMaxEnvSq) {
      fineMaxEnvSq = envSq;
      fineIdx = i;
    }
  }

  const envNorm = Math.sqrt(fineMaxEnvSq) / norm;
  if (envNorm > 0.01) {
    const offsets = [];
    for (let delta = -2; delta <= 2; delta++) {
      const candidate = fineIdx + delta;
      if (candidate >= 0 && candidate < frameLen) {
        offsets.push({ shift: candidate, isSyncPreamble: true });
      }
    }
    return offsets;
  }
  return [];
}

function scoreHypothesis(pcm, fmt, { key, payloadId, sampleRate, band }) {
  const { channels } = fmt;
  const perChannel = Math.floor(pcm.length / channels);
  const geometry = deriveGeometry(sampleRate, perChannel);
  const { slotLen, frameLen } = geometry;

  const candidates = [];
  const preambleOffsets = findPreambleOffsets(pcm, channels, sampleRate, geometry, key, band);
  for (const c of preambleOffsets) {
    candidates.push(c);
  }

  const maxShift = Math.floor(frameLen / 4);
  for (const f of RESYNC_FRACTIONS) {
    const shift = Math.round(f * frameLen);
    const clamped = Math.max(0, Math.min(maxShift, shift));
    if (!candidates.some((c) => c.shift === clamped)) candidates.push({ shift: clamped, isSyncPreamble: false });
  }

  let best = null;
  for (const { shift, isSyncPreamble } of candidates) {
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
    let correctedBits = [];
    if (!decoded.crcOk) {
      // Step 1: 1-bit flip sweep over sorted soft candidates
      for (const [, i] of absSorted) {
        const trial = Int8Array.from(hard);
        trial[i] = -trial[i];
        const t = unpackCodeword(trial);
        if (t.crcOk) {
          hard = trial;
          decoded = t;
          correctedBits = [i];
          break;
        }
      }

      // Step 2: 2-bit permutation sweep on the 8 lowest-confidence symbols (28 trials)
      if (!decoded.crcOk) {
        const topCandidates = absSorted.slice(0, 8);
        outer2Bit: for (let p = 0; p < topCandidates.length; p++) {
          for (let q = p + 1; q < topCandidates.length; q++) {
            const i1 = topCandidates[p][1];
            const i2 = topCandidates[q][1];
            const trial = Int8Array.from(hard);
            trial[i1] = -trial[i1];
            trial[i2] = -trial[i2];
            const t = unpackCodeword(trial);
            if (t.crcOk) {
              hard = trial;
              decoded = t;
              correctedBits = [i1, i2];
              break outer2Bit;
            }
          }
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
    const ebN0 = mu > 0 && sd > 0 ? (mu / sd) ** 2 : 1e-4;
    const ebN0Db = Number((10 * Math.log10(Math.max(1e-4, ebN0))).toFixed(2));
    const sqnrDb = Number((10 * Math.log10(Math.max(1e-4, ebN0 * reps))).toFixed(2));

    const isWinner =
      !best ||
      (decoded.crcOk && !best.decoded.crcOk) ||
      (decoded.crcOk === best.decoded.crcOk && confidence > best.confidence);

    if (isWinner) {
      best = {
        soft,
        hard,
        decoded,
        correctedBits,
        mu,
        sd,
        z,
        confidence,
        ebN0Db,
        sqnrDb,
        ber: berCount / BITS_PER_CODEWORD,
        reps,
        shiftUsed: shift,
        isSyncPreamble: isSyncPreamble || false,
      };
    }
  }
  return best;
}

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
    if (r) {
      const isBandWinner =
        !winner ||
        (r.decoded.crcOk && !winner.decoded.crcOk) ||
        (r.decoded.crcOk === winner.decoded.crcOk && r.confidence > winner.confidence);
      if (isBandWinner) {
        winner = r;
        winnerBand = band;
      }
    }
  }

  if (!winner) {
    throw new RangeError("audio too short for watermarking at this sample rate");
  }

  const idMatches =
    opts.payloadId === undefined || winner.decoded.id === opts.payloadId;
  const detected =
    winner.decoded.crcOk && idMatches && winner.confidence >= 0.5 && winner.mu > 0;

  // Resampling Invariance: If native detection fails, try canonical sample rates
  if (!detected && opts.resample !== false) {
    const candidateRates = [44100, 48000].filter((r) => r !== validated.sampleRate);
    for (const targetRate of candidateRates) {
      const perChannel = Math.floor(pcm.length / validated.channels);
      if (perChannel < validated.sampleRate * 0.9) continue;

      const resampledPcm = resamplePcm(pcm, validated.channels, validated.sampleRate, targetRate);
      const resampledFmt = { ...validated, sampleRate: targetRate };
      const subResult = detectWatermark(resampledPcm, resampledFmt, { ...opts, resample: false });
      if (subResult.detected) {
        subResult.resampled = true;
        subResult.originalSampleRate = validated.sampleRate;
        subResult.normalizedSampleRate = targetRate;
        subResult.details.resampled = true;
        subResult.details.originalSampleRate = validated.sampleRate;
        subResult.details.normalizedSampleRate = targetRate;
        return subResult;
      }
    }
  }

  return {
    detected,
    confidence: winner.confidence,
    ber: winner.ber,
    ebN0Db: winner.ebN0Db,
    sqnrDb: winner.sqnrDb,
    recoveredPayloadId: winner.decoded.crcOk ? winner.decoded.id : null,
    crcOk: winner.decoded.crcOk,
    reps: winner.reps,
    amplitude: winner.mu,
    details: {
      mode: opts.payloadId !== undefined ? "verify" : "blind",
      z: winner.z,
      ebN0Db: winner.ebN0Db,
      sqnrDb: winner.sqnrDb,
      meanAlignedAmplitude: winner.mu,
      amplitudeSpread: winner.sd,
      bitsCorrected: winner.correctedBits && winner.correctedBits.length > 0 ? winner.correctedBits : null,
      singleBitCorrected: winner.correctedBits && winner.correctedBits.length === 1 ? winner.correctedBits[0] : null,
      band: bands.length > 1 ? opts.band : winnerBand,
      bandUsed: winnerBand,
      bandsTried: bands.length,
      resyncShiftSamples: winner.shiftUsed,
      syncMethod: winner.isSyncPreamble ? "preamble" : "fractional_grid",
      sampleRate: validated.sampleRate,
      channels: validated.channels,
      perChannelSamples: Math.floor(pcm.length / validated.channels),
      bits: BITS_PER_CODEWORD,
    },
  };
}
