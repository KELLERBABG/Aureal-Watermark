import test from "node:test";
import assert from "node:assert/strict";
import { parseWav, writeWav, WavError } from "../src/index.js";
import { tone, wavBuffer } from "./helpers.js";

const SR = 22050;

test("writeWav -> parseWav round-trips 16, 24 and 32-bit audio", () => {
  const samples = tone(1, SR, 1, "roundtrip");
  for (const bitDepth of [16, 24, 32]) {
    const parsed = parseWav(writeWav(samples, { sampleRate: SR, channels: 1, bitDepth }));
    assert.equal(parsed.sampleRate, SR);
    assert.equal(parsed.channels, 1);
    assert.equal(parsed.bitsPerSample, bitDepth);
    assert.equal(parsed.numFrames, samples.length);
    let maxErr = 0;
    for (let i = 0; i < samples.length; i++) maxErr = Math.max(maxErr, Math.abs(samples[i] - parsed.samples[i]));
    const tolerance = bitDepth === 16 ? 1e-4 : bitDepth === 24 ? 1e-6 : 1e-7;
    assert.ok(maxErr < tolerance, `${bitDepth}-bit max error ${maxErr}`);
  }
});

test("writeWav supports stereo and reports the right duration", () => {
  const samples = tone(2, SR, 2, "stereo");
  const parsed = parseWav(writeWav(samples, { sampleRate: SR, channels: 2, bitDepth: 16 }));
  assert.equal(parsed.channels, 2);
  assert.ok(Math.abs(parsed.durationSec - 2) < 0.01);
});

test("parseWav reads 8-bit unsigned PCM", () => {
  const frames = 1000;
  const buf = Buffer.alloc(44 + frames);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + frames, 4); buf.write("WAVE", 8); buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(8000, 24);
  buf.writeUInt32LE(8000, 28); buf.writeUInt16LE(1, 32); buf.writeUInt16LE(8, 34); buf.write("data", 36); buf.writeUInt32LE(frames, 40);
  for (let i = 0; i < frames; i++) buf[44 + i] = i & 255;
  const parsed = parseWav(buf);
  assert.equal(parsed.bitsPerSample, 8);
  assert.ok(Math.abs(parsed.samples[0] + 1) < 1e-9);
  assert.ok(Math.abs(parsed.samples[255] - (255 - 128) / 128) < 1e-9);
});

test("parseWav handles WAVE_FORMAT_EXTENSIBLE 32-bit float", () => {
  const frames = 500;
  const dataLen = frames * 4;
  const buf = Buffer.alloc(44 + 24 + dataLen);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + 24 + dataLen, 4); buf.write("WAVE", 8);
  buf.write("fmt ", 12); buf.writeUInt32LE(40, 16); buf.writeUInt16LE(0xfffe, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(44100, 24); buf.writeUInt32LE(44100 * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(32, 34);
  buf.writeUInt16LE(22, 36); buf.writeUInt16LE(32, 38); buf.writeUInt16LE(4, 40); buf.writeUInt16LE(3, 44);
  buf.write("data", 60); buf.writeUInt32LE(dataLen, 64);
  for (let i = 0; i < frames; i++) buf.writeFloatLE(0.5, 68 + i * 4);
  const parsed = parseWav(buf);
  assert.equal(parsed.format, "IEEE float 32-bit");
  assert.ok(Math.abs(parsed.samples[10] - 0.5) < 1e-9);
});

test("parseWav rejects malformed and compressed input", () => {
  const truncated = Buffer.alloc(60);
  truncated.write("RIFF", 0); truncated.writeUInt32LE(52, 4); truncated.write("WAVE", 8);
  truncated.write("fmt ", 12); truncated.writeUInt32LE(9999, 16);
  for (const bad of [
    Buffer.alloc(0),
    Buffer.from("this is definitely not audio"),
    Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("XXXX"), Buffer.alloc(40)]),
    truncated,
  ]) {
    assert.throws(() => parseWav(bad), WavError);
  }
  // A real MP3 must not be silently accepted.
  const mp3 = Buffer.concat([Buffer.from([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00]), Buffer.alloc(200)]);
  assert.throws(() => parseWav(mp3), WavError);
});

test("parseWav rejects a compressed WAVE format code", () => {
  const buf = wavBuffer(new Float32Array(2000), 44100, 1, 16);
  buf.writeUInt16LE(0x0055, 20); // MPEG Layer-3
  assert.throws(() => parseWav(buf), /unsupported\/compressed WAVE format/);
});

test("writeWav validates its arguments", () => {
  assert.throws(() => writeWav(new Float32Array(100), { sampleRate: 44100, channels: 1, bitDepth: 12 }), WavError);
  assert.throws(() => writeWav(new Float32Array(101), { sampleRate: 44100, channels: 2 }), WavError);
  assert.throws(() => writeWav(new Float32Array(100), { sampleRate: 0, channels: 1 }), WavError);
});
