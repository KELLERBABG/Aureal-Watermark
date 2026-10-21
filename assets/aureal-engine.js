// assets/aureal-engine.js — GENERATED FILE, DO NOT EDIT.
//
// Written by scripts/build-engine.js from the canonical modules in src/.
// Run `node scripts/build-engine.js` after changing any of:
//   src/signal.js, src/payload.js, src/resample.js, src/embed.js, src/detect.js
// CI runs `node scripts/build-engine.js --check` and fails if this file is stale.

(function (global) {
  "use strict";
const DEFAULT_KEY = "aural-watermark-default-key";

// ---- src/signal.js ----
function hashSeed(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function makeRng(seed) {
  const s = typeof seed === "string" ? hashSeed(seed) : seed >>> 0;
  let x = mix(s ^ 0x9e3779b9);
  let y = mix(s ^ 0x85ebca6b);
  let z = mix(s ^ 0xc2b2ae35);
  let w = mix(s ^ 0x27d4eb2f);
  if ((x | y | z | w) === 0) w = 1;
  return function next() {
    const t = x ^ (x << 11);
    x = y;
    y = z;
    z = w;
    w = (w ^ (w >>> 19) ^ t ^ (t >>> 8)) >>> 0;
    return w / 4294967296;
  };
}

function mix(v) {
  v >>>= 0;
  v = Math.imul(v ^ (v >>> 16), 0x7feb352d);
  v = Math.imul(v ^ (v >>> 15), 0x846ca68b);
  return (v ^ (v >>> 16)) >>> 0;
}

function makeSymbolStream(key, label) {
  const rng = makeRng(key + "|" + label);
  return () => (rng() < 0.5 ? -1 : 1);
}

const hannCache = new Map();
function hannWindow(n) {
  let w = hannCache.get(n);
  if (!w) {
    w = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
    }
    hannCache.set(n, w);
  }
  return w;
}

const DEFAULT_BAND = Object.freeze({ lowHz: 17000, centerHz: 18250, highHz: 19500 });
const BITS_PER_CODEWORD = 48;
const CHIPS_PER_SLOT = 24;

const BAND_PRESETS = Object.freeze({
  high: Object.freeze({ lowHz: 17000, highHz: 19500 }),
  mid: Object.freeze({ lowHz: 4500, highHz: 13500 }),
});

function bandPreset(name) {
  const key = String(name || "").toLowerCase();
  if (key === "high" || key === "mid") return BAND_PRESETS[key];
  return null;
}

function clampInt(v, lo, hi, name) {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new TypeError(`${name} must be a finite number`);
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

/**
 * Resolve a band spec to concrete, Nyquist-safe low/high frequencies.
 * Values are clamped into [1000 Hz, sampleRate/2 − 100 Hz].
 */
function resolveBand(band, sampleRate) {
  const preset = band === "high" || band === "mid" ? bandPreset(band) : null;
  const b = { ...DEFAULT_BAND, ...(preset || (band && typeof band === "object" ? band : {})) };
  const limit = Math.floor(sampleRate / 2) - 100;
  if (!Number.isFinite(limit) || limit < 1200) {
    throw new RangeError(
      `sampleRate ${sampleRate} Hz is too low for watermarking: need at least ~2.6 kHz (Nyquist must exceed 1.3 kHz)`
    );
  }
  const lowHz = clampInt(b.lowHz, 1000, limit - 100, "band.lowHz");
  const highHz = clampInt(b.highHz, lowHz + 100, limit, "band.highHz");
  return { lowHz, highHz, centerHz: (lowHz + highHz) / 2 };
}

const MIN_BAND_WIDTH = 200;

/** True when a resolved band is wide enough to carry a signal and sits under Nyquist. */
function usableBand(b, sampleRate) {
  return b.highHz - b.lowHz >= MIN_BAND_WIDTH && b.highHz <= Math.floor(sampleRate / 2) - 100;
}

/**
 * Choose a single wide band inside the available spectrum when a preset cannot fit
 * under Nyquist (low sample rates such as 8 kHz or 16 kHz).
 */
function fallbackBand(sampleRate) {
  const limit = Math.floor(sampleRate / 2) - 100;
  const lowHz = Math.max(1000, Math.round(limit * 0.55));
  const highHz = limit;
  return { lowHz, highHz, centerHz: (lowHz + highHz) / 2 };
}

/**
 * Parse a custom band selector. Accepts an object `{ lowHz, highHz }` or a
 * `"17000:19500"` / `"17000-19500"` string. Returns null for preset names and
 * for anything that does not describe a concrete frequency range.
 */
function parseBandSpec(spec) {
  if (spec && typeof spec === "object") {
    if (!("lowHz" in spec) && !("highHz" in spec)) return null;
    const lowHz = Number(spec.lowHz);
    const highHz = Number(spec.highHz);
    if (!Number.isFinite(lowHz)) throw new TypeError("band.lowHz must be a finite number");
    if (!Number.isFinite(highHz)) throw new TypeError("band.highHz must be a finite number");
    return { lowHz, highHz };
  }
  if (typeof spec === "string") {
    const m = spec.trim().match(/^(\d+(?:\.\d+)?)\s*[:\-]\s*(\d+(?:\.\d+)?)$/);
    if (m) return { lowHz: Number(m[1]), highHz: Number(m[2]) };
  }
  return null;
}

/**
 * Resolve a band specification to the list of bands to embed/detect.
 *
 *  - "high"    → the high preset (or a wide fallback band if it cannot fit)
 *  - "mid"     → the mid preset  (or a wide fallback band if it cannot fit)
 *  - "dual"    → both presets that fit; if neither fits, one fallback band
 *  - {lowHz, highHz} or "lowHz:highHz" / "lowHz-highHz" → exactly that band;
 *    throws if it cannot fit under Nyquist
 *
 * A band is never returned degenerate (lowHz === highHz), and the same list is
 * never returned twice, so "dual" cannot silently double-embed one carrier.
 */
function bandList(spec, sampleRate) {
  const custom = parseBandSpec(spec);
  if (custom) {
    const band = resolveBand(custom, sampleRate);
    if (!usableBand(band, sampleRate)) {
      throw new RangeError(
        `band ${custom.lowHz}-${custom.highHz} Hz does not fit below Nyquist for ${sampleRate} Hz ` +
        `(usable range up to ${Math.floor(sampleRate / 2) - 100} Hz, minimum width ${MIN_BAND_WIDTH} Hz)`
      );
    }
    return [band];
  }
  if (spec === "high" || spec === "mid") {
    const band = resolveBand(spec, sampleRate);
    return [usableBand(band, sampleRate) ? band : fallbackBand(sampleRate)];
  }
  // Default and "auto"/"dual": every preset that actually fits at this rate.
  const bands = [];
  for (const name of ["high", "mid"]) {
    const band = resolveBand(name, sampleRate);
    if (usableBand(band, sampleRate) && !bands.some((b) => b.lowHz === band.lowHz && b.highHz === band.highHz)) {
      bands.push(band);
    }
  }
  return bands.length ? bands : [fallbackBand(sampleRate)];
}

function deriveGeometry(sampleRate, perChannelSamples, opts = {}) {
  const frameSeconds = opts.frameSeconds ?? 1.0;
  let slotLen = Math.max(1, Math.round((frameSeconds * sampleRate) / BITS_PER_CODEWORD));
  const maxSlot = Math.floor(perChannelSamples / BITS_PER_CODEWORD);
  if (slotLen > maxSlot) slotLen = maxSlot;
  let chipLen = Math.max(4, Math.floor(slotLen / CHIPS_PER_SLOT));
  slotLen = chipLen * CHIPS_PER_SLOT;
  const frameLen = slotLen * BITS_PER_CODEWORD;
  const reps = Math.floor(perChannelSamples / frameLen);
  if (reps < 1) {
    throw new RangeError(
      `audio too short for watermarking: need >= ${frameLen} samples/channel (~${(
        frameLen / sampleRate
      ).toFixed(2)}s), got ${perChannelSamples}`
    );
  }
  return { slotLen, chipLen, frameLen, reps, bits: BITS_PER_CODEWORD };
}

function buildTemplate({ key, sampleRate, geometry, band }) {
  const { slotLen, chipLen, frameLen } = geometry;
  const { centerHz } = resolveBand(band, sampleRate);
  const carrier = new Float64Array(chipLen);
  const win = hannWindow(chipLen);
  const w0 = (2 * Math.PI * centerHz) / sampleRate;
  for (let i = 0; i < chipLen; i++) carrier[i] = win[i] * Math.sin(w0 * i);

  const template = new Float64Array(frameLen);
  const slotNorms = new Float64Array(BITS_PER_CODEWORD);
  for (let b = 0; b < BITS_PER_CODEWORD; b++) {
    const sym = makeSymbolStream(key, "bit" + b);
    let norm = 0;
    const base = b * slotLen;
    for (let c = 0; c < CHIPS_PER_SLOT; c++) {
      const s = sym();
      const off = base + c * chipLen;
      for (let j = 0; j < chipLen; j++) {
        const v = s * carrier[j];
        template[off + j] = v;
        norm += v * v;
      }
    }
    slotNorms[b] = norm;
  }
  return { template, slotNorms };
}

const BARKER_7 = Object.freeze([1, 1, 1, -1, -1, 1, -1]);

function buildSyncPreamble({ key, sampleRate, geometry, band }) {
  const { slotLen } = geometry;
  const syncLen = slotLen;
  const { lowHz, highHz } = resolveBand(band, sampleRate);
  const chirpI = new Float64Array(syncLen);
  const chirpQ = new Float64Array(syncLen);
  const T = syncLen / sampleRate;
  const phi0 = ((hashSeed(key + "|sync_chirp") % 1000) / 1000) * 2 * Math.PI;

  for (let n = 0; n < syncLen; n++) {
    const t = n / sampleRate;
    const phase = phi0 + 2 * Math.PI * (lowHz * t + ((highHz - lowHz) / (2 * T)) * t * t);
    const win = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / syncLen);
    chirpI[n] = win * Math.cos(phase);
    chirpQ[n] = win * Math.sin(phase);
  }

  let normSq = 0;
  for (let n = 0; n < syncLen; n++) normSq += chirpQ[n] * chirpQ[n];
  const norm = Math.sqrt(normSq) || 1.0;

  return { chirpI, chirpQ, syncLen, norm };
}

// ---- src/payload.js ----
const PAYLOAD_BITS = 32;
const CRC_BITS = 16;


function crc16(bytes) {
  let crc = 0xffff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i] << 8;
    for (let b = 0; b < 8; b++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc >>> 0;
}

function isValidPayloadId(v) {
  return Number.isInteger(v) && v >= 0 && v <= 0xffffffff;
}

function packCodeword(payloadId) {
  if (!isValidPayloadId(payloadId)) {
    throw new TypeError(`payloadId must be an integer in [0, 2^32-1], got ${payloadId}`);
  }
  const out = new Int8Array(BITS_PER_CODEWORD);
  for (let i = 0; i < PAYLOAD_BITS; i++) {
    out[i] = (payloadId >>> (PAYLOAD_BITS - 1 - i)) & 1 ? 1 : -1;
  }
  const bytes = [
    (payloadId >>> 24) & 0xff,
    (payloadId >>> 16) & 0xff,
    (payloadId >>> 8) & 0xff,
    payloadId & 0xff,
  ];
  const crc = crc16(bytes);
  for (let i = 0; i < CRC_BITS; i++) {
    out[PAYLOAD_BITS + i] = (crc >>> (CRC_BITS - 1 - i)) & 1 ? 1 : -1;
  }
  return out;
}

function unpackCodeword(cw) {
  if (cw.length !== BITS_PER_CODEWORD) throw new RangeError("codeword must have 48 symbols");
  let id = 0;
  for (let i = 0; i < PAYLOAD_BITS; i++) {
    id = Math.imul(id, 2) + (cw[i] > 0 ? 1 : 0);
  }
  let crcRx = 0;
  for (let i = 0; i < CRC_BITS; i++) {
    crcRx = Math.imul(crcRx, 2) + (cw[PAYLOAD_BITS + i] > 0 ? 1 : 0);
  }
  const crcCalc = crc16([(id >>> 24) & 255, (id >>> 16) & 255, (id >>> 8) & 255, id & 255]);
  return { id: id >>> 0, crcOk: crcCalc === crcRx };
}

function hamming(a, b) {
  let d = 0;
  for (let i = 0; i < a.length; i++) if ((a[i] > 0) !== (b[i] > 0)) d++;
  return d;
}

// ---- src/resample.js ----
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
function resamplePcm(pcm, channels, inRate, outRate) {
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

// ---- src/embed.js ----
const MAX_AMPLITUDE = 0.0085;
const MULTI_BAND_SCALE = 0.85;
const MID_BAND_PERCEPTUAL_WEIGHT = 0.42;

function embedWatermark(pcm, fmt, opts) {
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

function validateFmt(fmt, totalSamples) {
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

// ---- src/detect.js ----
const Z_FLOOR = 3.0;
const Z_FULL = 30.0;
const RESYNC_FRACTIONS = [0, 1 / 16, 2 / 16, 4 / 16, -1 / 16, -2 / 16, -4 / 16];

function foldRepetitions(pcm, channels, frameLen, startOffset, totalSamples, isSide = false) {
  const folded = new Float64Array(frameLen);
  let count = 0;
  for (
    let base = startOffset;
    base + frameLen <= totalSamples;
    base += frameLen
  ) {
    let idx = base * channels;
    for (let n = 0; n < frameLen; n++) {
      if (isSide && channels >= 2) {
        folded[n] += pcm[idx] - pcm[idx + 1];
      } else {
        let acc = 0;
        for (let ch = 0; ch < channels; ch++) acc += pcm[idx + ch];
        folded[n] += acc;
      }
      idx += channels;
    }
    count++;
  }

  // Circular modulo frame folding for unaligned crops (when totalSamples >= frameLen but count is 0)
  if (count === 0 && totalSamples >= frameLen) {
    const hits = new Uint16Array(frameLen);
    for (let i = 0; i < totalSamples; i++) {
      const pos = ((i - startOffset) % frameLen + frameLen) % frameLen;
      const idx = i * channels;
      if (isSide && channels >= 2) {
        folded[pos] += pcm[idx] - pcm[idx + 1];
      } else {
        let acc = 0;
        for (let ch = 0; ch < channels; ch++) acc += pcm[idx + ch];
        folded[pos] += acc;
      }
      hits[pos]++;
    }
    let allCovered = true;
    for (let n = 0; n < frameLen; n++) {
      if (hits[n] === 0) {
        allCovered = false;
        break;
      }
      folded[n] /= hits[n];
    }
    if (allCovered) {
      count = 1;
    }
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
  const isSide = String(key).endsWith("|side");
  for (let i = 0; i < searchLen + syncLen; i++) {
    if (isSide && channels >= 2) {
      mono[i] = (pcm[i * channels] - pcm[i * channels + 1]) / 2;
    } else {
      let sum = 0;
      for (let ch = 0; ch < channels; ch++) sum += pcm[i * channels + ch];
      mono[i] = sum / channels;
    }
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
  const isMid = band && band.lowHz < 14000;
  const minEnv = isMid ? 0.005 : 0.015;
  if (envNorm > minEnv) {
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

  const isSide = String(key).endsWith("|side");
  let best = null;
  for (const { shift, isSyncPreamble } of candidates) {
    const { folded, reps } = foldRepetitions(
      pcm,
      channels,
      frameLen,
      shift,
      perChannel,
      isSide
    );
    if (reps < 1 || perChannel < frameLen) continue;

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

function detectWatermark(pcm, fmt, opts = {}) {
  const validated = validateFmt(fmt, pcm.length);
  const key = typeof opts.key === "string" && opts.key.length ? opts.key : DEFAULT_KEY;
  if (opts.payloadId !== undefined && !isValidPayloadId(opts.payloadId)) {
    throw new TypeError(`bad payloadId ${opts.payloadId}`);
  }

  const keysToTry = [key];
  if (!key.endsWith("|side")) keysToTry.push(key + "|side");

  const bands = bandList(opts.band, validated.sampleRate);
  let winner = null;
  let winnerBand = null;
  let winnerKey = key;

  for (const currentKey of keysToTry) {
    for (const band of bands) {
      const r = scoreHypothesis(pcm, validated, {
        key: currentKey,
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
          winnerKey = currentKey;
        }
      }
    }
    if (winner && winner.decoded.crcOk && winner.confidence >= 0.5) break;
  }

  if (!winner) {
    throw new RangeError("audio too short for watermarking at this sample rate");
  }

  const idMatches =
    opts.payloadId === undefined || winner.decoded.id === opts.payloadId;
  const minConfidence = winner.decoded.crcOk ? 0.35 : 0.5;
  const detected =
    winner.decoded.crcOk && idMatches && winner.confidence >= minConfidence && winner.mu > 0;

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

  // Speed / Pitch Drift Invariance: If native detection fails, try micro-drift rake sweep
  if (!detected && opts.drift !== false) {
    const driftFactors = [1.002, 0.998, 1.005, 0.995, 1.01, 0.99];
    for (const factor of driftFactors) {
      const outRate = Math.round(validated.sampleRate * factor);
      const resampledPcm = resamplePcm(pcm, validated.channels, validated.sampleRate, outRate);
      const subResult = detectWatermark(
        resampledPcm,
        validated,
        { ...opts, drift: false, resample: false }
      );
      if (subResult.detected) {
        subResult.driftFactor = factor;
        subResult.details.driftFactor = factor;
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
      softSymbols: winner.soft ? Array.from(winner.soft) : null,
    },
  };
}

  global.AurealEngine = Object.freeze({
    embedWatermark,
    detectWatermark,
    resamplePcm,
    validateFmt,
    packCodeword,
    unpackCodeword,
    crc16,
    DEFAULT_KEY,
    DEFAULT_BAND,
    BAND_PRESETS,
    BITS_PER_CODEWORD,
  });
})(typeof globalThis !== "undefined" ? globalThis : self);
