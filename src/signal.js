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
  mid: Object.freeze({ lowHz: 8000, highHz: 13000 }),
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

export function resolveBand(band, sampleRate) {
  const preset = band === "high" || band === "mid" ? bandPreset(band) : null;
  const b = { ...DEFAULT_BAND, ...(preset || band || {}) };
  let { lowHz, highHz } = b;
  lowHz = clampInt(lowHz, 1000, sampleRate / 2 - 100, "band.lowHz");
  highHz = clampInt(highHz, lowHz + 100, sampleRate / 2 - 100, "band.highHz");
  return { lowHz, highHz, centerHz: (lowHz + highHz) / 2 };
}

export function bandList(spec, sampleRate) {
  if (spec === "dual" || spec === "auto") {
    return [resolveBand("high", sampleRate), resolveBand("mid", sampleRate)];
  }
  return [resolveBand(spec ?? undefined, sampleRate)];
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
