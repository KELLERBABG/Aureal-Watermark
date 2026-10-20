// src/tardos.js — Tardos probabilistic fingerprinting code & accusation scorer.
//
// IMPORTANT SCOPE NOTE
// --------------------
// This module implements the *scoring half* of the Tardos (2003) / Skorić et al. (2008)
// symmetric fingerprinting code: it can generate a codebook and score recipient
// codewords against soft symbol observations. It is NOT wired to the audio signal:
// embedWatermark() only ever embeds packCodeword(payloadId), so a Tardos codeword never
// enters the carrier. To use this module you must supply your own signalling channel that
// embeds a per-recipient codeword at the required length (Tardos needs m ≈ 20·c² symbols
// for a coalition of c; the audio frame carries 48 symbol slots per ~1 s, which is far too
// few for meaningful collusion security at c ≥ 3).
//
// Collusion is therefore a documented limitation of the watermark, not a protected threat:
// averaging enough independently-tagged copies erases the recovered ID.

import { makeRng } from "./signal.js";

/**
 * Sample a bias p in [t, 1-t] from Tardos distribution density:
 * f(p) = 1 / (2 * arcsin(1 - 2*t) * sqrt(p * (1 - p)))
 */
function sampleTardosBias(rng, t) {
  const c = Math.asin(1 - 2 * t);
  const u = rng(); // uniform [0, 1]
  const val = Math.sin((2 * u - 1) * c);
  const p = (1 - val) / 2;
  return Math.min(1 - t, Math.max(t, p));
}

/**
 * Generate a Tardos fingerprint codebook for a list of recipients.
 * @param {object} opts
 * @param {number} opts.numRecipients - Number of recipients (e.g. 10..100)
 * @param {number} [opts.codeLength=48] - Number of symbols m (default 48 symbols = 1 codeword frame)
 * @param {number} [opts.maxCoalition=5] - Maximum expected coalition size c
 * @param {string} [opts.seedKey="tardos-seed"] - Deterministic master key
 */
export function generateTardosCodebook(opts = {}) {
  const {
    numRecipients = 10,
    codeLength = 48,
    maxCoalition = 4,
    seedKey = "tardos-default-key",
  } = opts;

  const rng = makeRng(seedKey);
  const t = Math.max(0.01, Math.min(0.25, 1 / (300 * maxCoalition)));

  // 1. Sample bias vector P = [p_1, ..., p_m]
  const biases = new Float64Array(codeLength);
  for (let j = 0; j < codeLength; j++) {
    biases[j] = sampleTardosBias(rng, t);
  }

  // 2. Generate binary codewords for each recipient
  const codebook = [];
  for (let i = 0; i < numRecipients; i++) {
    const codeword = new Int8Array(codeLength);
    for (let j = 0; j < codeLength; j++) {
      // Sample bit X_{i,j} in {-1, +1} where Pr[X = +1] = biases[j]
      codeword[j] = rng() < biases[j] ? 1 : -1;
    }
    codebook.push(codeword);
  }

  return {
    biases: Array.from(biases),
    cutoff: t,
    codeLength,
    codebook,
  };
}

/**
 * Score all candidate recipients against recovered soft symbol correlations Y.
 * 
 * Symmetric Tardos scoring function:
 * If X_{i,j} == +1: g = y_j * sqrt((1 - p_j) / p_j)
 * If X_{i,j} == -1: g = -y_j * sqrt(p_j / (1 - p_j))
 * 
 * @param {Array<number>|Float64Array} softSymbols - Extracted soft correlation per symbol in [-1, 1]
 * @param {Array<{id: any, name: string, codeword: Array<number>}>} recipients - Recipient list with codewords
 * @param {Array<number>} biases - Bias vector from generation
 * @returns {object} Accusation report with ranking, scores, and colluder coalition
 */
export function accuseCoalition(softSymbols, recipients, biases) {
  const m = Math.min(softSymbols.length, biases.length);
  const scores = [];

  let maxPossibleScore = 0;
  for (let j = 0; j < m; j++) {
    const pj = biases[j];
    maxPossibleScore += Math.max(Math.sqrt((1 - pj) / pj), Math.sqrt(pj / (1 - pj)));
  }

  for (const r of recipients) {
    let u = 0;
    const cw = r.codeword;
    for (let j = 0; j < m; j++) {
      const y = softSymbols[j];
      const pj = biases[j];
      if (cw[j] > 0) {
        // Recipient symbol was +1
        u += y * Math.sqrt((1 - pj) / pj);
      } else {
        // Recipient symbol was -1
        u -= y * Math.sqrt(pj / (1 - pj));
      }
    }

    scores.push({
      id: r.id,
      name: r.name,
      score: u,
      normalizedScore: u / (Math.sqrt(m) + 1e-9),
    });
  }

  // Sort descending by score
  scores.sort((a, b) => b.score - a.score);

  // Compute robust statistics (Median and Median Absolute Deviation) to avoid outlier skewing
  const sortedValues = scores.map((s) => s.score).slice().sort((a, b) => a - b);
  const median = sortedValues[Math.floor(sortedValues.length / 2)];
  const diffs = sortedValues.map((v) => Math.abs(v - median)).sort((a, b) => a - b);
  const mad = diffs[Math.floor(diffs.length / 2)] || 1.0;
  const robustStdDev = 1.4826 * mad;

  // Accusation threshold: significantly above innocent median and > 1.4 * sqrt(m)
  const theoreticalMin = 1.4 * Math.sqrt(m);
  const threshold = Math.max(theoreticalMin, median + 1.8 * robustStdDev);
  const accused = scores.filter((s) => s.score >= threshold && s.score > 0);

  return {
    accused,
    isCollusion: accused.length > 1,
    topSuspect: scores[0] || null,
    threshold,
    medianScore: median,
    robustStdDev,
    rankedScores: scores,
  };
}
