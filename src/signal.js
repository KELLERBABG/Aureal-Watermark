export function hashSeed(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function makeRng(seed) {
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

export function makeSymbolStream(key, label) {
  const rng = makeRng(key + "|" + label);
  return () => (rng() < 0.5 ? -1 : 1);
}

const hannCache = new Map();
export function hannWindow(n) {
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

export const DEFAULT_BAND = Object.freeze({ lowHz: 17000, centerHz: 18250, highHz: 19500 });
export const BITS_PER_CODEWORD = 48;
export const CHIPS_PER_SLOT = 24;

export const BAND_PRESETS = Object.freeze({
  high: Object.freeze({ lowHz: 17000, highHz: 19500 }),
  mid: Object.freeze({ lowHz: 4500, highHz: 13500 }),
});

export function bandPreset(name) {
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
export function resolveBand(band, sampleRate) {
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
export function bandList(spec, sampleRate) {
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

export function deriveGeometry(sampleRate, perChannelSamples, opts = {}) {
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

export function buildTemplate({ key, sampleRate, geometry, band }) {
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

export const BARKER_7 = Object.freeze([1, 1, 1, -1, -1, 1, -1]);

export function buildSyncPreamble({ key, sampleRate, geometry, band }) {
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
