"use strict";

// browser.test.js — verifies the dependency-free browser verifier module
// against a real generated WAV file (runs in Node; same code path as in
// the browser since no Node-only APIs are involved).

import { test } from "node:test";
import assert from "node:assert/strict";

import { readWavFile, writeWav } from "../src/wav.js";
import { synthesizeSpeechLike } from "../src/synth.js";
import { embedWatermark } from "../src/embed.js";
import { verifyWav } from "../src/browser/aural-watermark-verify.js";

const ID = 7654321;
const KEY = "browser-test-key";
const RATE = 44100;

async function makeWavBuffer(band) {
  const pcm = synthesizeSpeechLike({ seconds: 12, sampleRate: RATE, channels: 1 });
  const wm = embedWatermark(pcm, { sampleRate: RATE, channels: 1 }, {
    payloadId: ID,
    key: KEY,
    strength: 0.5,
    band,
  });
  return writeWav(wm, { sampleRate: RATE, channels: 1, bitDepth: 16 });
}

test("verifyWav erkennt Wasserzeichen im Browser-Modul (dual)", async () => {
  const buf = await makeWavBuffer("dual");
  const r = verifyWav(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), ID, KEY);
  assert.equal(r.detected, true);
  assert.ok(r.confidence >= 0.5);
});

test("verifyWav lehnt falsche ID ab", async () => {
  const buf = await makeWavBuffer("mid");
  const r = verifyWav(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), (ID ^ 0x1111) >>> 0, KEY);
  assert.equal(r.detected, false);
});
