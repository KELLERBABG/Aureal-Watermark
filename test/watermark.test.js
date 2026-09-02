// test/watermark.test.js — embed/detect round trips, rejection and robustness.

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { embedWatermark } from "../src/embed.js";
import { detectWatermark } from "../src/detect.js";
import { synthesizeSpeechLike } from "../src/synth.js";
import { packCodeword, unpackCodeword } from "../src/payload.js";
import { resamplePcm } from "../src/resample.js";

const RATE = 48000;
const ID = 0x1234abcd; // 305441741
const KEY = "unit-test-key";

let host; // unwatermarked synthetic speech-like signal
let marked; // watermarked copy
const fmt = { sampleRate: RATE, channels: 1 };

before(() => {
  host = synthesizeSpeechLike({ seconds: 12, sampleRate: RATE, channels: 1, seed: "tests" });
  assert.equal(host.length, 12 * RATE);
  marked = embedWatermark(host, fmt, { payloadId: ID, key: KEY, strength: 0.5 });
});

function addWhiteNoise(pcm, dbfs) {
  const rms = Math.pow(10, dbfs / 20);
  // deterministic LCG so runs are reproducible
  let s = 123456789 >>> 0;
  const out = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const u1 = ((s + 1) >>> 1) / 2147483648; // (0..1)
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const u2 = ((s + 1) >>> 1) / 2147483648;
    const g = Math.sqrt(-2 * Math.log(u1 + 1e-12)) * Math.cos(2 * Math.PI * u2); // Box-Muller
    out[i] = pcm[i] + g * rms;
  }
  return out;
}

test("codeword packing: id -> 48 bits with valid CRC", () => {
  const cw = packCodeword(ID);
  assert.equal(cw.length, 48);
  assert.deepEqual(unpackCodeword(cw), { id: ID, crcOk: true });
  const bad = Int8Array.from(cw);
  bad[7] = -bad[7];
  assert.equal(unpackCodeword(bad).crcOk, false);
});

test("clean embed -> detect: detected, BER 0, confidence > 0.8", () => {
  const res = detectWatermark(marked, fmt, { key: KEY, payloadId: ID });
  assert.equal(res.detected, true);
  assert.equal(res.ber, 0);
  assert.ok(res.confidence > 0.8, `confidence ${res.confidence}`);
  assert.equal(res.recoveredPayloadId, ID);
  assert.equal(res.crcOk, true);
});

test("blind detection (no expected id) recovers the id", () => {
  const res = detectWatermark(marked, fmt, { key: KEY });
  assert.equal(res.detected, true);
  assert.equal(res.recoveredPayloadId, ID);
  assert.ok(res.confidence >= 0.5);
});

test("unwatermarked audio is rejected", () => {
  const res = detectWatermark(host, fmt, { key: KEY, payloadId: ID });
  assert.equal(res.detected, false);
  assert.ok(res.confidence < 0.5, `confidence ${res.confidence} should be low`);
});

test("wrong expected id is rejected", () => {
  const res = detectWatermark(marked, fmt, { key: KEY, payloadId: (ID ^ 0x00ff0000) >>> 0 });
  assert.equal(res.detected, false);
  assert.ok(res.confidence < 0.5, `confidence ${res.confidence} should be low`);
  assert.ok(res.ber > 0.25, "wrong id should produce many bit disagreements");
});

test("wrong key is rejected", () => {
  const res = detectWatermark(marked, fmt, { key: "somebody-else", payloadId: ID });
  assert.equal(res.detected, false);
  assert.ok(res.confidence < 0.5, `confidence ${res.confidence} should be low`);
  assert.ok(res.recoveredPayloadId === null || res.recoveredPayloadId !== ID || !res.crcOk);
});

test("robust to additive white noise at -30 dBFS", () => {
  const noisy = addWhiteNoise(marked, -30);
  const res = detectWatermark(noisy, fmt, { key: KEY, payloadId: ID });
  assert.equal(res.detected, true, `expected detection under noise, got ${JSON.stringify(res.details)}`);
  assert.ok(res.confidence > 0.8, `confidence ${res.confidence}`);
});

test("robust to gain change x0.5", () => {
  const quiet = new Float32Array(marked.length);
  for (let i = 0; i < marked.length; i++) quiet[i] = marked[i] * 0.5;
  const res = detectWatermark(quiet, fmt, { key: KEY, payloadId: ID });
  assert.equal(res.detected, true);
  assert.equal(res.ber, 0);
  assert.equal(res.recoveredPayloadId, ID);
});

test("robust to gain change x2 (with clipping)", () => {
  const loud = new Float32Array(marked.length);
  for (let i = 0; i < marked.length; i++) loud[i] = Math.max(-1, Math.min(1, marked[i] * 2));
  const res = detectWatermark(loud, fmt, { key: KEY, payloadId: ID });
  assert.equal(res.detected, true);
});

test("stereo embedding survives and detects", () => {
  const stereoFmt = { sampleRate: RATE, channels: 2 };
  const st = synthesizeSpeechLike({ seconds: 3, sampleRate: RATE, channels: 2, seed: "st" });
  const stMarked = embedWatermark(st, stereoFmt, { payloadId: 777, key: KEY, strength: 0.6 });
  const res = detectWatermark(stMarked, stereoFmt, { key: KEY, payloadId: 777 });
  assert.equal(res.detected, true);
  assert.equal(res.recoveredPayloadId, 777);
});

test("detect on digital silence returns not-detected without crashing", () => {
  const silence = new Float32Array(RATE * 2);
  const res = detectWatermark(silence, fmt, { key: KEY, payloadId: ID });
  assert.equal(res.detected, false);
  assert.ok(Number.isFinite(res.confidence));
});

test("too-short audio throws a helpful range error", () => {
  const tiny = new Float32Array(1000);
  assert.throws(
    () => embedWatermark(tiny, fmt, { payloadId: 1, key: KEY }),
    /too short/
  );
});

test("dynamic psychoacoustic masking mutes carrier on digital silence", () => {
  const silence = new Float32Array(RATE * 2);
  const result = embedWatermark(silence, fmt, { payloadId: ID, key: KEY });
  // Silence should remain 100% pure silence (zero carrier injected)
  let maxAbs = 0;
  for (let i = 0; i < result.length; i++) {
    if (Math.abs(result[i]) > maxAbs) maxAbs = Math.abs(result[i]);
  }
  assert.equal(maxAbs, 0.0);
});

test("headroom protection prevents digital clipping on 0 dBFS hot masters", () => {
  const hotAudio = new Float32Array(RATE * 2);
  hotAudio.fill(0.98); // near digital peak
  const markedHot = embedWatermark(hotAudio, fmt, { payloadId: ID, key: KEY, strength: 1.0 });
  let maxPeak = 0;
  for (let i = 0; i < markedHot.length; i++) {
    if (Math.abs(markedHot[i]) > maxPeak) maxPeak = Math.abs(markedHot[i]);
  }
  assert.ok(maxPeak <= 0.999, `maxPeak ${maxPeak} exceeded 0.999 limit`);
});

test("2-bit soft-decision permutation sweep recovers corrupted codeword", () => {
  const codeword = packCodeword(883921);
  const corrupted = Int8Array.from(codeword);
  // Flip 2 bits
  corrupted[10] = -corrupted[10];
  corrupted[20] = -corrupted[20];
  const decodedDirect = unpackCodeword(corrupted);
  assert.equal(decodedDirect.crcOk, false, "CRC should fail before correction");

  // Run through 2-bit sweep
  const absSorted = Array.from({ length: 48 }, (_, i) => [i === 10 || i === 20 ? 0.01 : 0.5, i])
    .sort((a, b) => a[0] - b[0]);
  const topCandidates = absSorted.slice(0, 8);
  let repaired = null;
  outer: for (let p = 0; p < topCandidates.length; p++) {
    for (let q = p + 1; q < topCandidates.length; q++) {
      const i1 = topCandidates[p][1];
      const i2 = topCandidates[q][1];
      const trial = Int8Array.from(corrupted);
      trial[i1] = -trial[i1];
      trial[i2] = -trial[i2];
      const t = unpackCodeword(trial);
      if (t.crcOk) {
        repaired = t;
        break outer;
      }
    }
  }
  assert.ok(repaired !== null, "2-bit sweep should find valid CRC");
  assert.equal(repaired.id, 883921);
});

test("resampling invariance recovers watermark across 48kHz -> 44.1kHz downsampling", () => {
  const pcm48 = synthesizeSpeechLike({ seconds: 6, sampleRate: 48000, channels: 1, seed: "resample-test-48" });
  const fmt48 = { sampleRate: 48000, channels: 1 };
  const wm48 = embedWatermark(pcm48, fmt48, { payloadId: 771122, key: KEY });

  // Resample to 44.1 kHz (e.g. streaming downsampling)
  const pcm44 = resamplePcm(wm48, 1, 48000, 44100);
  const fmt44 = { sampleRate: 44100, channels: 1 };

  const res = detectWatermark(pcm44, fmt44, { expectedId: 771122, key: KEY });
  assert.equal(res.detected, true, "Watermark should be detected despite resampling");
  assert.equal(res.recoveredPayloadId, 771122);
  assert.equal(res.resampled, true);
  assert.equal(res.normalizedSampleRate, 48000);
});

test("resampling invariance recovers watermark across 44.1kHz -> 48kHz upsampling", () => {
  const pcm44 = synthesizeSpeechLike({ seconds: 6, sampleRate: 44100, channels: 1, seed: "resample-test-44" });
  const fmt44 = { sampleRate: 44100, channels: 1 };
  const wm44 = embedWatermark(pcm44, fmt44, { payloadId: 334455, key: KEY });

  // Resample to 48 kHz (e.g. broadcast upsampling)
  const pcm48 = resamplePcm(wm44, 1, 44100, 48000);
  const fmt48 = { sampleRate: 48000, channels: 1 };

  const res = detectWatermark(pcm48, fmt48, { expectedId: 334455, key: KEY });
  assert.equal(res.detected, true, "Watermark should be detected despite upsampling");
  assert.equal(res.recoveredPayloadId, 334455);
  assert.equal(res.resampled, true);
  assert.equal(res.normalizedSampleRate, 44100);
});

test("stream synchronization preamble locks onto arbitrary crop offsets", () => {
  const pcm = synthesizeSpeechLike({ seconds: 8, sampleRate: 44100, channels: 1, seed: "preamble-sync-test" });
  const format = { sampleRate: 44100, channels: 1 };
  const wm = embedWatermark(pcm, format, { payloadId: 998877, key: KEY });

  // Arbitrary crop offset of 5,432 samples (~123ms), not on standard fractional grid
  const cropOffset = 5432;
  const cropped = wm.subarray(cropOffset);

  const res = detectWatermark(cropped, format, { expectedId: 998877, key: KEY });
  assert.equal(res.detected, true, "Watermark should be detected after arbitrary crop");
  assert.equal(res.recoveredPayloadId, 998877);
  assert.equal(res.details.syncMethod, "preamble", "Detection should lock via preamble sync");
});
