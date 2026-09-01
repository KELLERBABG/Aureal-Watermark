// wav.js — minimal RIFF/WAVE reader & writer for uncompressed PCM.
// Supports 8/16/24/32-bit integer PCM and 32-bit IEEE float, mono or
// multi-channel. Samples are exposed as interleaved Float32 in [-1, 1].

const RIFF_LE = 0x46464952; // "RIFF" read little-endian
const WAVE_LE = 0x45564157; // "WAVE" read little-endian

function u32le(b, o) {
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
}
function u16le(b, o) {
  return b[o] | (b[o + 1] << 8);
}
function tag(b, o) {
  return String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
}

export class WavError extends Error {}

/**
 * Parse a WAVE file image.
 * @param {Uint8Array|Buffer} bytes
 * @returns {{sampleRate:number, channels:number, bitsPerSample:number,
 *            numFrames:number, samples:Float32Array, durationSec:number,
 *            format:string}}
 */
export function parseWav(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new WavError("input must be a Uint8Array/Buffer");
  const b = bytes;
  if (b.length < 12 || u32le(b, 0) !== RIFF_LE || u32le(b, 8) !== WAVE_LE) {
    throw new WavError("not a RIFF/WAVE file");
  }

  let fmt = null;
  let data = null;

  let pos = 12;
  while (pos + 8 <= b.length) {
    const id = tag(b, pos);
    const size = u32le(b, pos + 4);
    const body = pos + 8;
    if (body + size > b.length) {
      throw new WavError(`truncated chunk '${id}': declares ${size} bytes, only ${b.length - body} present`);
    }
    if (id === "fmt ") {
      if (size < 16) throw new WavError("fmt chunk too small");
      fmt = {
        audioFormat: u16le(b, body),
        channels: u16le(b, body + 2),
        sampleRate: u32le(b, body + 4),
        byteRate: u32le(b, body + 8),
        blockAlign: u16le(b, body + 12),
        bitsPerSample: u16le(b, body + 14),
        size,
      };
      // WAVE_FORMAT_EXTENSIBLE: real format code is the first 2 bytes of SubFormat GUID at offset 24.
      if (fmt.audioFormat === 0xfffe && size >= 40) {
        fmt.audioFormat = u16le(b, body + 24);
      }
    } else if (id === "data") {
      if (!data) data = { offset: body, size };
    }
    pos = body + size + (size & 1); // chunks are padded to even length
  }

  if (!fmt) throw new WavError("missing fmt chunk");
  if (!data) throw new WavError("missing data chunk");

  const { audioFormat, channels, sampleRate, bitsPerSample } = fmt;
  if (channels < 1 || channels > 64) throw new WavError(`unsupported channel count ${channels}`);
  if (sampleRate < 1 || sampleRate > 768000) throw new WavError(`implausible sample rate ${sampleRate}`);

  let formatName;
  if (audioFormat === 0x0001 && [8, 16, 24, 32].includes(bitsPerSample)) {
    formatName = `PCM ${bitsPerSample}-bit`;
  } else if (audioFormat === 0x0003 && bitsPerSample === 32) {
    formatName = "IEEE float 32-bit";
  } else {
    const known = {
      0x0006: "A-law",
      0x0007: "mu-law",
      0x0055: "MPEG Layer-3 (MP3)",
      0x0050: "MPEG-1",
      0x0011: "ADPCM (IMA)",
      0x0002: "ADPCM (MS)",
      0x00ff: "AAC",
      0x0003: "IEEE float",
    };
    throw new WavError(
      `unsupported/compressed WAVE format 0x${audioFormat.toString(16).padStart(4, "0")} (${
        known[audioFormat] ?? "unknown codec"
      }) — only uncompressed PCM is supported`
    );
  }

  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = channels * bytesPerSample;
  const usable = data.size - (data.size % blockAlign);
  if (usable <= 0) throw new WavError("data chunk holds no complete frames");
  const numFrames = usable / blockAlign;

  const samples = new Float32Array(numFrames * channels);
  let p = data.offset;
  if (bitsPerSample === 8) {
    for (let i = 0; i < samples.length; i++, p += 1) samples[i] = (b[p] - 128) / 128;
  } else if (bitsPerSample === 16) {
    for (let i = 0; i < samples.length; i++, p += 2) {
      let v = b[p] | (b[p + 1] << 8);
      if (v & 0x8000) v -= 0x10000; // signed
      samples[i] = v / 32768;
    }
  } else if (bitsPerSample === 24) {
    for (let i = 0; i < samples.length; i++, p += 3) {
      let v = b[p] | (b[p + 1] << 8) | (b[p + 2] << 16);
      if (v & 0x800000) v |= ~0xffffff; // sign-extend
      samples[i] = v / 8388608;
    }
  } else if (bitsPerSample === 32 && audioFormat === 0x0001) {
    for (let i = 0; i < samples.length; i++, p += 4) samples[i] = int32le(b, p) / 2147483648;
  } else {
    // float32
    const dv = new DataView(b.buffer, b.byteOffset + data.offset, usable);
    for (let i = 0; i < samples.length; i++) samples[i] = dv.getFloat32(i * 4, true);
  }

  return {
    sampleRate,
    channels,
    bitsPerSample,
    numFrames,
    samples,
    durationSec: numFrames / sampleRate,
    format: formatName,
  };
}

function int32le(b, o) {
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) | 0;
}

/**
 * Encode interleaved float samples as a canonical 44-byte-header PCM WAV.
 * @param {Float32Array|number[]} samples interleaved
 * @param {{sampleRate:number, channels:number, bitDepth?:number}} opts bitDepth 16|24
 * @returns {Buffer}
 */
export function writeWav(samples, opts) {
  const { sampleRate, channels } = opts;
  const bitDepth = opts.bitDepth ?? 16;
  if (![16, 24].includes(bitDepth)) throw new WavError("writeWav supports 16 or 24 bit only");
  if (!Number.isInteger(channels) || channels < 1) throw new WavError("bad channel count");
  if (!Number.isInteger(sampleRate) || sampleRate < 1) throw new WavError("bad sample rate");
  if (samples.length % channels !== 0) {
    throw new WavError(`samples.length (${samples.length}) not a multiple of channels (${channels})`);
  }

  const frames = samples.length / channels;
  const bytesPerSample = bitDepth / 8;
  const dataLen = frames * channels * bytesPerSample;
  const padded = dataLen + (dataLen & 1);
  const buf = Buffer.alloc(44 + padded);

  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + padded, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * channels * bytesPerSample, 28);
  buf.writeUInt16LE(channels * bytesPerSample, 32);
  buf.writeUInt16LE(bitDepth, 34);
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataLen, 40);

  const peak = bitDepth === 16 ? 32767 : 8388607;
  let p = 44;
  for (let i = 0; i < samples.length; i++) {
    let s = Math.round(Math.max(-1, Math.min(1, samples[i])) * peak);
    if (bitDepth === 16) {
      buf.writeInt16LE(s, p);
      p += 2;
    } else {
      buf[p] = s & 255;
      buf[p + 1] = (s >> 8) & 255;
      buf[p + 2] = (s >> 16) & 255;
      p += 3;
    }
  }
  return buf;
}

/** Convenience: read + parse a WAVE file from disk. */
export async function readWavFile(path) {
  const { readFile } = await import("node:fs/promises");
  return parseWav(new Uint8Array(await readFile(path)));
}

/** Convenience: encode + write interleaved float samples to disk. */
export async function writeWavFile(path, samples, opts) {
  const { writeFile } = await import("node:fs/promises");
  return writeFile(path, writeWav(samples, opts));
}
