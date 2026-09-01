// aural-watermark-verify.js — dependency-free browser verifier.
//
// Exposes:
//  - verifyAudioBuffer(audioBuffer, expectedId, key, opts): verifies any decoded
//    Web Audio AudioBuffer (MP3, AAC, M4A, OGG, FLAC, WAV, WebM).
//  - verifyWav(arrayBuffer, expectedId, key, opts): parses a raw PCM WAV
//    (16/24/32-bit int or 32-bit float) via DataView and verifies it directly.
//
// No Node APIs are used anywhere: safe for <script type="module"> and bundlers.

import { detectWatermark } from "../detect.js";

function riffError(msg) {
  throw new Error(`Invalid WAV file: ${msg}`);
}

/** Minimal RIFF walker returning the raw data payload of the fmt/data pair. */
function parseWav(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  if (arrayBuffer.byteLength < 12) riffError("File too small.");
  if (view.getUint32(0, false) !== 0x52494646) riffError("Missing RIFF header."); // "RIFF"
  if (view.getUint32(8, false) !== 0x57415645) riffError("Not a WAVE file."); // "WAVE"

  let offset = 12;
  let fmt = null;
  let data = null;
  while (offset + 8 <= arrayBuffer.byteLength) {
    const id = view.getUint32(offset, false);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (body + size > arrayBuffer.byteLength && id !== 0x64617461) break;
    if (id === 0x666d7420) {
      // "fmt "
      const audioFormat = view.getUint16(body, true);
      const channels = view.getUint16(body + 2, true);
      const sampleRate = view.getUint32(body + 4, true);
      const bitsPerSample = view.getUint16(body + 14, true);
      const extFormat =
        audioFormat === 0xfffe && body + 26 <= arrayBuffer.byteLength
          ? view.getUint16(body + 24, true)
          : audioFormat;
      fmt = { audioFormat: extFormat, channels, sampleRate, bitsPerSample };
    } else if (id === 0x64617461) {
      // "data"
      data = new Uint8Array(arrayBuffer, body, Math.min(size, arrayBuffer.byteLength - body));
    }
    offset = body + size + (size % 2); // chunks are word-aligned
  }

  if (!fmt) riffError("Missing fmt chunk.");
  if (!data) riffError("Missing data chunk.");
  return { fmt, data };
}

const DECODERS = {
  8: (u8, i) => (u8[i] - 128) / 128,
  16: (u8, i) => {
    const v = (u8[i] | (u8[i + 1] << 8)) << 16 >> 16;
    return v / 32768;
  },
  24: (u8, i) => {
    const v = (u8[i] | (u8[i + 1] << 8) | (u8[i + 2] << 16)) << 8 >> 8;
    return v / 8388608;
  },
  32: (u8, i, isFloat) =>
    isFloat
      ? (() => { const b = new ArrayBuffer(4); new Uint8Array(b).set(u8.subarray(i, i + 4)); return new Float32Array(b)[0]; })()
      : ((u8[i] | (u8[i + 1] << 8) | (u8[i + 2] << 16) | (u8[i + 3] << 24)) | 0) / 2147483648,
};

function pcmToFloat32(u8, fmt) {
  const bytesPer = fmt.bitsPerSample / 8;
  const decode = DECODERS[fmt.bitsPerSample];
  if (!decode) riffError(`${fmt.bitsPerSample}-bit depth is not supported.`);
  const isFloat = fmt.audioFormat === 3;
  const frames = Math.floor(u8.length / (bytesPer * fmt.channels));
  const out = new Float32Array(frames * fmt.channels);
  for (let f = 0; f < frames; f++) {
    for (let c = 0; c < fmt.channels; c++) {
      out[f * fmt.channels + c] = decode(u8, (f * fmt.channels + c) * bytesPer, isFloat);
    }
  }
  return out;
}

/**
 * Convert a standard Web Audio AudioBuffer to interleaved Float32Array samples.
 *
 * @param {AudioBuffer} audioBuffer
 * @returns {{pcm: Float32Array, sampleRate: number, channels: number}}
 */
export function audioBufferToPcm(audioBuffer) {
  const channels = audioBuffer.numberOfChannels;
  const length = audioBuffer.length;
  const pcm = new Float32Array(length * channels);
  const chData = [];
  for (let c = 0; c < channels; c++) {
    chData.push(audioBuffer.getChannelData(c));
  }
  for (let i = 0; i < length; i++) {
    for (let c = 0; c < channels; c++) {
      pcm[i * channels + c] = chData[c][i];
    }
  }
  return { pcm, sampleRate: audioBuffer.sampleRate, channels };
}

/**
 * Run watermark detection on raw interleaved PCM Float32Array samples.
 *
 * @param {Float32Array} pcm
 * @param {{sampleRate: number, channels: number}} fmt
 * @param {number|null|undefined} [expectedId] uint32 payload id (or undefined for blind detection)
 * @param {string} [key] secret key used at embed time
 * @param {{band?: string|object}} [opts]
 */
export function verifyPcm(pcm, fmt, expectedId, key, opts = {}) {
  if (expectedId != null && !Number.isInteger(expectedId)) {
    throw new TypeError("expectedId must be an integer (or left empty for blind auto-detection).");
  }
  try {
    const r = detectWatermark(pcm, { sampleRate: fmt.sampleRate, channels: fmt.channels }, {
      key,
      payloadId: expectedId != null ? (expectedId >>> 0) : undefined,
      band: opts.band ?? "auto",
    });
    return {
      detected: r.detected,
      confidence: r.confidence,
      ber: r.ber,
      recoveredPayloadId: r.recoveredPayloadId,
      crcOk: r.crcOk,
      bandUsed: r.details.bandUsed?.lowHz ? `high/mid (${Math.round(r.details.bandUsed.lowHz)}–${Math.round(r.details.bandUsed.highHz)} Hz)` : null,
      reps: r.reps,
      details: r.details,
    };
  } catch (err) {
    return { detected: false, confidence: 0, ber: 1, recoveredPayloadId: null, bandUsed: null, error: err.message };
  }
}

/**
 * Verify watermark inside any Web Audio AudioBuffer (MP3, AAC, M4A, OGG, FLAC, WAV, etc.).
 *
 * @param {AudioBuffer} audioBuffer
 * @param {number|null|undefined} [expectedId] uint32 payload id (optional for blind detection)
 * @param {string} [key] secret key used at embed time
 * @param {{band?: string|object}} [opts]
 */
export function verifyAudioBuffer(audioBuffer, expectedId, key, opts = {}) {
  const { pcm, sampleRate, channels } = audioBufferToPcm(audioBuffer);
  return verifyPcm(pcm, { sampleRate, channels }, expectedId, key, opts);
}

/**
 * Verify an expected watermark id inside a raw WAV file buffer.
 *
 * @param {ArrayBuffer} arrayBuffer raw .wav file contents
 * @param {number|null|undefined} [expectedId] uint32 payload id (optional for blind detection)
 * @param {string} [key] secret key used at embed time
 * @param {{band?: string|object}} [opts]
 * @returns {{detected:boolean, confidence:number, ber:number,
 *            recoveredPayloadId:number|null, bandUsed:string|null, error?:string}}
 */
export function verifyWav(arrayBuffer, expectedId, key, opts = {}) {
  const { fmt, data } = parseWav(arrayBuffer);
  if (![1, 3, 0xfffe].includes(fmt.audioFormat)) {
    riffError("Only uncompressed PCM WAV is supported via direct parser (use AudioContext for MP3/AAC).");
  }
  const pcm = pcmToFloat32(data, fmt);
  return verifyPcm(pcm, { sampleRate: fmt.sampleRate, channels: fmt.channels }, expectedId, key, opts);
}
