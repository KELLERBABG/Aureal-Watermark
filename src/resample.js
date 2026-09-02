// src/resample.js — High-performance bandlimited windowed-sinc audio resampler.
// Zero-dependency, pure mathematical polyphase filter for Node.js and browser.

const POLYPHASE_PHASES = 64;
const FILTER_RADIUS = 16; // 32-tap sinc window
const filterCache = new Map();

function getPolyphaseTable(ratio) {
  const cutoff = Math.min(1.0, ratio);
  // Quantize cutoff to 3 decimal places for caching
  const key = Math.round(cutoff * 1000);
  let table = filterCache.get(key);
  if (table) return table;

  table = [];
  for (let p = 0; p < POLYPHASE_PHASES; p++) {
    const frac = p / POLYPHASE_PHASES;
    const weights = new Float32Array(FILTER_RADIUS * 2);
    let total = 0;

    for (let k = 0; k < FILTER_RADIUS * 2; k++) {
      const offset = k - FILTER_RADIUS + 1 - frac;
      const x = offset * cutoff;
      let w = 0;
      if (Math.abs(x) < 1e-7) {
        w = 1.0;
      } else {
        const piX = Math.PI * x;
        w = Math.sin(piX) / piX;
      }
      // Blackman window
      const t = offset / FILTER_RADIUS;
      if (Math.abs(t) <= 1.0) {
        const win = 0.42 + 0.5 * Math.cos(Math.PI * t) + 0.08 * Math.cos(2 * Math.PI * t);
        w *= win;
      } else {
        w = 0;
      }
      weights[k] = w;
      total += w;
    }

    // Normalize weights to preserve DC gain
    if (total !== 0) {
      for (let k = 0; k < FILTER_RADIUS * 2; k++) {
        weights[k] /= total;
      }
    }
    table.push(weights);
  }

  filterCache.set(key, table);
  return table;
}

/**
 * Resamples multi-channel interleaved Float32Array PCM audio.
 * @param {Float32Array} pcm Interleaved audio samples
 * @param {number} channels Number of channels (1 = mono, 2 = stereo)
 * @param {number} inRate Source sample rate (e.g. 48000)
 * @param {number} outRate Destination sample rate (e.g. 44100)
 * @returns {Float32Array} Resampled audio at outRate
 */
export function resamplePcm(pcm, channels, inRate, outRate) {
  if (!inRate || !outRate || inRate === outRate) return pcm;
  if (!pcm || pcm.length === 0) return pcm;

  const ratio = outRate / inRate;
  const inFrames = Math.floor(pcm.length / channels);
  const outFrames = Math.floor(inFrames * ratio);
  const out = new Float32Array(outFrames * channels);
  const table = getPolyphaseTable(ratio);
  const numPhases = POLYPHASE_PHASES;
  const radius = FILTER_RADIUS;

  for (let ch = 0; ch < channels; ch++) {
    for (let i = 0; i < outFrames; i++) {
      const srcPos = i / ratio;
      const center = Math.floor(srcPos);
      const frac = srcPos - center;
      const phaseIdx = Math.min(numPhases - 1, Math.max(0, Math.round(frac * numPhases)));
      const weights = table[phaseIdx];

      let sum = 0;
      for (let k = 0; k < radius * 2; k++) {
        const inIdx = center - radius + 1 + k;
        if (inIdx >= 0 && inIdx < inFrames) {
          sum += pcm[inIdx * channels + ch] * weights[k];
        }
      }
      out[i * channels + ch] = sum;
    }
  }

  return out;
}