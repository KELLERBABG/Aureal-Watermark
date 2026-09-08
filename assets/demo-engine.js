// assets/demo-engine.js — Aureal Client-Side Live DSP Engine for Interactive Demos
(function (global) {
  "use strict";

  const BITS_PER_CODEWORD = 48;
  const CHIPS_PER_SLOT = 24;
  const PAYLOAD_BITS = 32;
  const CRC_BITS = 16;
  const Z_FLOOR = 3.0;
  const Z_FULL = 30.0;
  const MAX_AMPLITUDE = 0.024;
  const MULTI_BAND_SCALE = 0.7;
  const MID_BAND_PERCEPTUAL_WEIGHT = 0.65;
  const RESYNC_FRACTIONS = [0, 1 / 16, 2 / 16, 4 / 16, -1 / 16, -2 / 16, -4 / 16];
  const DEFAULT_KEY = "aureal-provenance-salt-2026";

  const BAND_PRESETS = Object.freeze({
    high: Object.freeze({ lowHz: 16500, highHz: 19500 }),
    mid: Object.freeze({ lowHz: 8000, highHz: 13000 }),
  });
  const DEFAULT_BAND = BAND_PRESETS.high;

  function hashSeed(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  function mix(v) {
    v >>>= 0;
    v = Math.imul(v ^ (v >>> 16), 0x7feb352d);
    v = Math.imul(v ^ (v >>> 15), 0x846ca68b);
    return (v ^ (v >>> 16)) >>> 0;
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

  function clampInt(v, lo, hi) {
    const n = Number(v);
    return Math.min(hi, Math.max(lo, Math.round(n)));
  }

  function resolveBand(band, sampleRate) {
    const preset = band === "high" || band === "mid" ? BAND_PRESETS[band] : null;
    const b = { ...DEFAULT_BAND, ...(preset || band || {}) };
    let { lowHz, highHz } = b;
    lowHz = clampInt(lowHz, 1000, sampleRate / 2 - 100);
    highHz = clampInt(highHz, lowHz + 100, sampleRate / 2 - 100);
    return { lowHz, highHz, centerHz: (lowHz + highHz) / 2 };
  }

  function bandList(spec, sampleRate) {
    if (spec === "dual" || spec === "auto") {
      return [resolveBand("high", sampleRate), resolveBand("mid", sampleRate)];
    }
    return [resolveBand(spec || undefined, sampleRate)];
  }

  function deriveGeometry(sampleRate, perChannelSamples) {
    let slotLen = Math.max(1, Math.round((1.0 * sampleRate) / BITS_PER_CODEWORD));
    const maxSlot = Math.floor(perChannelSamples / BITS_PER_CODEWORD);
    if (slotLen > maxSlot) slotLen = maxSlot;
    let chipLen = Math.max(4, Math.floor(slotLen / CHIPS_PER_SLOT));
    slotLen = chipLen * CHIPS_PER_SLOT;
    const frameLen = slotLen * BITS_PER_CODEWORD;
    const reps = Math.floor(perChannelSamples / frameLen);
    if (reps < 1) {
      throw new RangeError(`Audio too short: need >= ${frameLen} samples (~${(frameLen / sampleRate).toFixed(2)}s), received ${perChannelSamples}`);
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
      const chipSigns = makeSymbolStream(key, `b${b}`)();
      const off = b * slotLen;
      let slotSq = 0;
      for (let c = 0; c < CHIPS_PER_SLOT; c++) {
        const sign = makeSymbolStream(key, `b${b}_c${c}`)();
        const coff = off + c * chipLen;
        for (let i = 0; i < chipLen; i++) {
          const val = sign * carrier[i];
          template[coff + i] = val;
          slotSq += val * val;
        }
      }
      slotNorms[b] = Math.sqrt(slotSq) || 1.0;
    }
    return { template, slotNorms };
  }

  function crc16(bytes) {
    let crc = 0xffff;
    for (const byte of bytes) {
      crc ^= byte << 8;
      for (let i = 0; i < 8; i++) {
        crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
      }
    }
    return crc;
  }

  function packCodeword(payloadId) {
    const id = payloadId >>> 0;
    const bytes = [(id >>> 24) & 255, (id >>> 16) & 255, (id >>> 8) & 255, id & 255];
    const out = new Int8Array(BITS_PER_CODEWORD);
    for (let i = 0; i < PAYLOAD_BITS; i++) {
      out[i] = (id >>> (PAYLOAD_BITS - 1 - i)) & 1 ? 1 : -1;
    }
    const crc = crc16(bytes);
    for (let i = 0; i < CRC_BITS; i++) {
      out[PAYLOAD_BITS + i] = (crc >>> (CRC_BITS - 1 - i)) & 1 ? 1 : -1;
    }
    return out;
  }

  function unpackCodeword(cw) {
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
    return { chirpI, chirpQ, syncLen, norm: Math.sqrt(normSq) || 1.0 };
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
    if (envNorm > 0.001) {
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

  function foldRepetitions(pcm, channels, frameLen, startOffset, usableSamples) {
    const folded = new Float64Array(frameLen);
    let count = 0;
    for (let base = startOffset; base + frameLen <= usableSamples; base += frameLen) {
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

  function scoreHypothesis(pcm, fmt, { key, payloadId, sampleRate, band }) {
    const { channels } = fmt;
    const perChannel = Math.floor(pcm.length / channels);
    const geometry = deriveGeometry(sampleRate, perChannel);
    const { slotLen, frameLen } = geometry;

    const candidates = [];
    const preambleOffsets = findPreambleOffsets(pcm, channels, sampleRate, geometry, key, band);
    for (const c of preambleOffsets) candidates.push(c);

    const maxShift = Math.floor(frameLen / 4);
    for (const f of RESYNC_FRACTIONS) {
      const shift = Math.round(f * frameLen);
      const clamped = Math.max(0, Math.min(maxShift, shift));
      if (!candidates.some((c) => Math.abs(c.shift - clamped) <= 4)) {
        candidates.push({ shift: clamped, isSyncPreamble: false });
      }
    }

    const { template, slotNorms } = buildTemplate({ key, sampleRate, geometry, band });
    let best = null;

    for (const { shift, isSyncPreamble } of candidates) {
      const { folded, reps } = foldRepetitions(pcm, channels, frameLen, shift, perChannel);
      if (reps < 1) continue;

      const soft = new Float64Array(BITS_PER_CODEWORD);
      const hard = new Int8Array(BITS_PER_CODEWORD);

      for (let b = 0; b < BITS_PER_CODEWORD; b++) {
        const off = b * slotLen;
        let dot = 0;
        for (let n = 0; n < slotLen; n++) {
          dot += folded[off + n] * template[off + n];
        }
        soft[b] = dot / (reps * channels * slotNorms[b]);
        hard[b] = soft[b] > 0 ? 1 : -1;
      }

      let decoded = unpackCodeword(hard);
      let correctedBits = 0;

      if (!decoded.crcOk) {
        const order = Array.from({ length: BITS_PER_CODEWORD }, (_, i) => i).sort(
          (a, b) => Math.abs(soft[a]) - Math.abs(soft[b])
        );
        for (let k = 0; k < Math.min(6, BITS_PER_CODEWORD); k++) {
          const idx = order[k];
          hard[idx] = -hard[idx];
          const test = unpackCodeword(hard);
          if (test.crcOk) {
            decoded = test;
            correctedBits = 1;
            break;
          }
          hard[idx] = -hard[idx];
        }
      }

      const refBits = payloadId !== undefined && (!decoded.crcOk || decoded.id !== payloadId)
        ? packCodeword(payloadId)
        : decoded.crcOk
          ? packCodeword(decoded.id)
          : hard;

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

      const isWinner =
        !best ||
        (decoded.crcOk && !best.decoded.crcOk) ||
        (decoded.crcOk === best.decoded.crcOk && confidence > best.confidence);

      if (isWinner) {
        best = { decoded, z, confidence, ebN0Db, ber: berCount / BITS_PER_CODEWORD, reps };
      }
    }
    return best;
  }

  function detectWatermarkCore(pcm, fmt, opts = {}) {
    const sampleRate = fmt.sampleRate;
    const key = typeof opts.key === "string" && opts.key.length ? opts.key : DEFAULT_KEY;
    const bands = bandList(opts.band || "auto", sampleRate);
    let winner = null;
    let winnerBand = null;

    for (const band of bands) {
      const r = scoreHypothesis(pcm, fmt, { key, payloadId: opts.payloadId, sampleRate, band });
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

    if (!winner) throw new RangeError("Audio too short for watermark detection.");

    const idMatches = opts.payloadId === undefined || winner.decoded.id === opts.payloadId;
    const detected = winner.decoded.crcOk && idMatches && winner.confidence >= 0.5;

    return {
      detected,
      confidence: winner.confidence,
      ber: winner.ber,
      ebN0Db: winner.ebN0Db,
      recoveredPayloadId: winner.decoded.crcOk ? winner.decoded.id : null,
      crcOk: winner.decoded.crcOk,
      reps: winner.reps,
      bandUsed: winnerBand ? `${winnerBand.lowHz >= 14000 ? "High Band" : "Mid Band"} (${Math.round(winnerBand.lowHz)}–${Math.round(winnerBand.highHz)} Hz)` : "Dual Band",
    };
  }

  function embedWatermarkCore(pcm, fmt, opts) {
    const { sampleRate, channels } = fmt;
    const key = typeof opts.key === "string" && opts.key.length ? opts.key : DEFAULT_KEY;
    const bands = bandList(opts.band || "dual", sampleRate);

    let strength = Number.isFinite(opts.strength) ? Math.min(1, Math.max(0.01, opts.strength)) : 0.5;
    const amp = Math.min(MAX_AMPLITUDE, Math.max(0.001, strength) * MAX_AMPLITUDE) * (bands.length > 1 ? MULTI_BAND_SCALE : 1);

    const perChannel = Math.floor(pcm.length / channels);
    const geometry = deriveGeometry(sampleRate, perChannel);
    const codeword = packCodeword(opts.payloadId);
    const { slotLen, frameLen, reps, bits } = geometry;

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
      for (let n = 0; n < syncLen; n++) {
        wm[n] += bandAmp * 0.35 * chirpQ[n];
      }
    }

    const out = new Float32Array(pcm.length);
    out.set(pcm);

    for (let r = 0; r < reps; r++) {
      const base = r * frameLen * channels;
      for (let ch = 0; ch < channels; ch++) {
        for (let b = 0; b < bits; b++) {
          const slotOffset = base + ch + b * slotLen * channels;
          let sumSq = 0;
          for (let n = 0; n < slotLen; n++) {
            const s = pcm[slotOffset + n * channels];
            sumSq += s * s;
          }
          const rms = Math.sqrt(sumSq / slotLen);
          const mask = rms <= 0.001 ? 0.0 : Math.min(1.0, (rms - 0.001) / 0.035);
          if (mask > 0) {
            const wmSlotBase = b * slotLen;
            let o = slotOffset;
            for (let n = 0; n < slotLen; n++) {
              out[o] += wm[wmSlotBase + n] * mask;
              o += channels;
            }
          }
        }
      }
    }

    let maxPeak = 0;
    for (let i = 0; i < out.length; i++) {
      const abs = Math.abs(out[i]);
      if (abs > maxPeak) maxPeak = abs;
    }
    if (maxPeak > 0.999) {
      const headroomScale = 0.995 / maxPeak;
      for (let i = 0; i < out.length; i++) out[i] *= headroomScale;
    }
    return out;
  }

  function encodeWavBlob(samples, sampleRate, channels, bitDepth = 16) {
    const bytesPerSample = bitDepth / 8;
    const frames = Math.floor(samples.length / channels);
    const dataLen = frames * channels * bytesPerSample;
    const padded = dataLen + (dataLen & 1);
    const buffer = new ArrayBuffer(44 + padded);
    const view = new DataView(buffer);

    view.setUint32(0, 0x52494646, false); // "RIFF"
    view.setUint32(4, 36 + padded, true);
    view.setUint32(8, 0x57415645, false); // "WAVE"
    view.setUint32(12, 0x666d7420, false); // "fmt "
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, channels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * channels * bytesPerSample, true);
    view.setUint16(32, channels * bytesPerSample, true);
    view.setUint16(34, bitDepth, true);
    view.setUint32(36, 0x64617461, false); // "data"
    view.setUint32(40, dataLen, true);

    const peak = bitDepth === 16 ? 32767 : 8388607;
    let offset = 44;
    for (let i = 0; i < samples.length; i++) {
      const s = Math.round(Math.max(-1, Math.min(1, samples[i])) * peak);
      view.setInt16(offset, s, true);
      offset += 2;
    }
    return new Blob([new Uint8Array(buffer)], { type: "audio/wav" });
  }

  // Synthesize rich acoustic harmonic track (speech/piano melody)
  function synthesizeSampleAudio(seconds = 5, sampleRate = 44100) {
    const totalFrames = Math.round(seconds * sampleRate);
    const pcm = new Float32Array(totalFrames * 2); // stereo
    const notes = [220, 261.63, 329.63, 392.00, 440, 523.25]; // Am chord arpeggio
    const noteDur = sampleRate * 0.65;

    for (let i = 0; i < totalFrames; i++) {
      const t = i / sampleRate;
      const noteIdx = Math.floor(i / noteDur) % notes.length;
      const f0 = notes[noteIdx];
      const noteT = (i % noteDur) / sampleRate;
      const env = Math.exp(-noteT * 3.5) * (1 - Math.exp(-noteT * 40));

      let s = 0;
      s += 0.55 * Math.sin(2 * Math.PI * f0 * t);
      s += 0.28 * Math.sin(2 * Math.PI * f0 * 2 * t);
      s += 0.14 * Math.sin(2 * Math.PI * f0 * 3 * t);
      s += 0.08 * Math.sin(2 * Math.PI * f0 * 4 * t);
      s *= env * 0.75;

      pcm[i * 2] = s;     // Left
      pcm[i * 2 + 1] = s; // Right
    }
    return { pcm, sampleRate, channels: 2 };
  }

  global.AurealDemo = {
    synthesizeSample: synthesizeSampleAudio,
    embedWatermark: embedWatermarkCore,
    detectWatermark: detectWatermarkCore,
    encodeWavBlob: encodeWavBlob,
    defaultKey: DEFAULT_KEY
  };
})(typeof window !== "undefined" ? window : globalThis);
