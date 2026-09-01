// test/wav.test.js — WAV parser/writer round trips + error handling.

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseWav, writeWav, WavError } from "../src/wav.js";

function makeWavBytes({ formatCode = 1, channels = 1, rate = 48000, bits = 16, framesData, extraPad = true }) {
  const bytesPerSample = bits / 8;
  const dataLen = framesData.length;
  const padded = extraPad && dataLen % 2 ? dataLen + 1 : dataLen;
  const buf = Buffer.alloc(44 + padded);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + padded, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(formatCode, 20);
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * channels * bytesPerSample, 28);
  buf.writeUInt16LE(channels * bytesPerSample, 32);
  buf.writeUInt16LE(bits, 34);
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataLen, 40);
  framesData.copy(buf, 44);
  return buf;
}

function encodeSamples(samples, channels, bits) {
  const bps = bits / 8;
  const peak = bits === 16 ? 32767 : 8388607;
  const out = Buffer.alloc(samples.length * bps);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.round(Math.max(-1, Math.min(1, samples[i])) * peak);
    if (bits === 16) out.writeInt16LE(v, i * 2);
    else {
      out[i * 3] = v & 255;
      out[i * 3 + 1] = (v >> 8) & 255;
      out[i * 3 + 2] = (v >> 16) & 255;
    }
  }
  void channels;
  void bps;
  return out;
}

test("write->parse round trip preserves 16-bit mono samples", () => {
  const n = 1000;
  const orig = new Float32Array(n);
  for (let i = 0; i < n; i++) orig[i] = Math.sin((2 * Math.PI * 220 * i) / 48000) * 0.5;
  const bytes = writeWav(orig, { sampleRate: 48000, channels: 1, bitDepth: 16 });
  const parsed = parseWav(bytes);
  assert.equal(parsed.sampleRate, 48000);
  assert.equal(parsed.channels, 1);
  assert.equal(parsed.bitsPerSample, 16);
  assert.equal(parsed.numFrames, n);
  let maxErr = 0;
  for (let i = 0; i < n; i++) maxErr = Math.max(maxErr, Math.abs(parsed.samples[i] - orig[i]));
  assert.ok(maxErr <= 1.01 / 32768, `maxErr ${maxErr}`);
});

test("write->parse round trip preserves 24-bit stereo samples", () => {
  const frames = 777;
  const orig = new Float32Array(frames * 2);
  for (let i = 0; i < frames; i++) {
    orig[2 * i] = Math.sin((2 * Math.PI * 99 * i) / 44100) * 0.8;
    orig[2 * i + 1] = -Math.sin((2 * Math.PI * 997 * i) / 44100) * 0.3;
  }
  const bytes = writeWav(orig, { sampleRate: 44100, channels: 2, bitDepth: 24 });
  const parsed = parseWav(bytes);
  assert.equal(parsed.channels, 2);
  assert.equal(parsed.bitsPerSample, 24);
  let maxErr = 0;
  for (let i = 0; i < orig.length; i++) maxErr = Math.max(maxErr, Math.abs(parsed.samples[i] - orig[i]));
  assert.ok(maxErr <= 1.01 / 8388608, `maxErr ${maxErr}`);
});

test("24-bit mono with odd byte count is padded and parses", () => {
  // 3 frames mono 24-bit = 9 bytes -> odd -> pad byte appended
  const raw = Buffer.from([10, 0, 0, 200, 50, 255, 0, 128, 255]);
  const bytes = makeWavBytes({ channels: 1, rate: 8000, bits: 24, framesData: raw });
  const parsed = parseWav(bytes);
  assert.equal(parsed.numFrames, 3);
  assert.deepEqual([...parsed.samples].map((v) => Math.round(v * 8388608)), [
    10,
    -52536, // 0xFF32C8 sign-extended
    -32768, // 0xFF8000 sign-extended
  ]);
});

function riffChunk(id, body) {
  const h = Buffer.alloc(8);
  h.write(id, 0, "ascii");
  h.writeUInt32LE(body.length, 4);
  const pad = body.length % 2 ? Buffer.from([0]) : Buffer.alloc(0);
  return Buffer.concat([h, body, pad]);
}

test("parser accepts extra chunks before fmt/data", () => {
  const pcm = Buffer.from([0x34, 0x12, 0xcd, 0xab]); // 2 frames mono 16-bit
  const fmtBody = Buffer.alloc(16);
  fmtBody.writeUInt16LE(1, 0); // PCM
  fmtBody.writeUInt16LE(1, 2);
  fmtBody.writeUInt32LE(8000, 4);
  fmtBody.writeUInt32LE(16000, 8);
  fmtBody.writeUInt16LE(2, 12);
  fmtBody.writeUInt16LE(16, 14);
  const listBody = Buffer.from("INFOoddbin", "ascii"); // odd length -> pad exercised
  const waveBody = Buffer.concat([
    riffChunk("LIST", listBody),
    riffChunk("fmt ", fmtBody),
    riffChunk("data", pcm),
  ]);
  const head = Buffer.alloc(8);
  head.write("RIFF", 0, "ascii");
  head.writeUInt32LE(4 + waveBody.length, 4);
  const waveTag = Buffer.from("WAVE", "ascii");
  const parsed = parseWav(Buffer.concat([head, waveTag, waveBody]));
  assert.equal(parsed.sampleRate, 8000);
  assert.equal(parsed.numFrames, 2);
});

test("rejects non-RIFF garbage", () => {
  assert.throws(() => parseWav(Buffer.from("this is not audio at all........")), WavError);
});

test("rejects compressed formats (MP3 in a WAV wrapper)", () => {
  const bytes = makeWavBytes({ formatCode: 0x0055, framesData: Buffer.alloc(16) });
  assert.throws(() => parseWav(bytes), /compressed|0x0055|MP3/i);
});

test("rejects A-law", () => {
  const bytes = makeWavBytes({ formatCode: 0x0006, bits: 8, framesData: Buffer.alloc(8) });
  assert.throws(() => parseWav(bytes), /compressed|A-law/i);
});

test("rejects missing data chunk", () => {
  const buf = Buffer.alloc(44);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(44100, 24);
  buf.writeUInt32LE(88200, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  assert.throws(() => parseWav(buf), /missing data/);
});

test("rejects truncated data chunk", () => {
  const raw = encodeSamples(new Float32Array(100).fill(0), 1, 16);
  const good = makeWavBytes({ framesData: raw });
  assert.throws(
    () => parseWav(good.subarray(0, good.length - 40)),
    /truncated/
  );
});

test("round trip through writer keeps channel interleave intact", () => {
  const frames = 4;
  const orig = new Float32Array(frames * 2);
  for (let f = 0; f < frames; f++) {
    orig[2 * f] = f / frames;
    orig[2 * f + 1] = -(f / frames);
  }
  const parsed = parseWav(writeWav(orig, { sampleRate: 16000, channels: 2, bitDepth: 16 }));
  const norm = (v) => v + 0; // collapse -0 to 0
  assert.deepEqual([...parsed.samples].map(norm), [...orig].map((v) => Math.round(v * 32767) / 32768).map(norm));
});
