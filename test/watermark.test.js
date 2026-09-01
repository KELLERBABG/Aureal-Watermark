// test/watermark.test.js — embed/detect round trips, rejection and robustness.

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { embedWatermark } from "../src/embed.js";
import { detectWatermark } from "../src/detect.js";
import { synthesizeSpeechLike } from "../src/synth.js";
import { packCodeword, unpackCodeword } from "../src/payload.js";

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
