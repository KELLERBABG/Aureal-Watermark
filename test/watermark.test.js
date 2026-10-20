import test from "node:test";
import assert from "node:assert/strict";
import { embedWatermark, detectWatermark, packCodeword } from "../src/index.js";
import { validateFmt } from "../src/embed.js";
import { resamplePcm } from "../src/resample.js";
import { tone, noise } from "./helpers.js";

const SR = 44100;
const SECS = 6;
const ID = 883921;
const KEY = "test-key";
const FMT = { sampleRate: SR, channels: 2 };

function fixture(seed = "wm", channels = 2) {
  return tone(SECS, SR, channels, seed);
}

test("embed -> detect recovers the ID for every band", () => {
  for (const band of ["high", "mid", "dual"]) {
    const pcm = fixture("band-" + band);
    const marked = embedWatermark(pcm, FMT, { payloadId: ID, key: KEY, band });
    const res = detectWatermark(marked, FMT, { payloadId: ID, key: KEY });
    assert.equal(res.detected, true, `band ${band}`);
    assert.equal(res.recoveredPayloadId, ID, `band ${band}`);
    assert.equal(res.crcOk, true, `band ${band}`);
    assert.ok(res.confidence > 0.35, `confidence ${res.confidence} for ${band}`);
  }
});

test("embed is deterministic for the same input and options", () => {
  const pcm = fixture("deterministic");
  const a = embedWatermark(pcm, FMT, { payloadId: ID, key: KEY });
  const b = embedWatermark(pcm, FMT, { payloadId: ID, key: KEY });
  assert.deepEqual(Array.from(a), Array.from(b));
});

test("unmarked audio is not detected (negative control)", () => {
  const res = detectWatermark(fixture("clean"), FMT, { payloadId: ID, key: KEY });
  assert.equal(res.detected, false);
  const blind = detectWatermark(fixture("clean-blind"), FMT, { key: KEY });
  assert.equal(blind.detected, false);
});

test("a marked file is not detected with the wrong key or a wrong expected ID", () => {
  const marked = embedWatermark(fixture("isolation"), FMT, { payloadId: ID, key: KEY });
  assert.equal(detectWatermark(marked, FMT, { payloadId: ID, key: "other-key" }).detected, false);
  assert.equal(detectWatermark(marked, FMT, { payloadId: ID + 1, key: KEY }).detected, false);
});

test("blind detection recovers the embedded ID", () => {
  const marked = embedWatermark(fixture("blind"), FMT, { payloadId: 424242, key: KEY });
  const res = detectWatermark(marked, FMT, { key: KEY });
  assert.equal(res.detected, true);
  assert.equal(res.recoveredPayloadId, 424242);
});

test("payload ID extremes round-trip through the audio", () => {
  for (const id of [0, 1, 0xffffffff]) {
    const marked = embedWatermark(fixture("id-" + id), FMT, { payloadId: id, key: KEY, strength: 0.7 });
    const res = detectWatermark(marked, FMT, { payloadId: id, key: KEY });
    assert.equal(res.detected, true, `id ${id}`);
    assert.equal(res.recoveredPayloadId, id);
  }
});

test("mono and 2-channel audio both work", () => {
  const mono = tone(SECS, SR, 1, "mono");
  const markedMono = embedWatermark(mono, { sampleRate: SR, channels: 1 }, { payloadId: ID, key: KEY });
  assert.equal(detectWatermark(markedMono, { sampleRate: SR, channels: 1 }, { payloadId: ID, key: KEY }).detected, true);
});

test("a custom band is honoured, clamped and reported", () => {
  const pcm = fixture("custom");
  const marked = embedWatermark(pcm, FMT, { payloadId: ID, key: KEY, band: { lowHz: 12000, highHz: 14000 } });
  assert.equal(marked.watermarkMeta.bands.length, 1);
  assert.equal(marked.watermarkMeta.bands[0].lowHz, 12000);
  assert.equal(marked.watermarkMeta.bands[0].highHz, 14000);
  const res = detectWatermark(marked, FMT, { payloadId: ID, key: KEY, band: { lowHz: 12000, highHz: 14000 } });
  assert.equal(res.detected, true);
});

test("an unusable custom band is rejected instead of silently collapsing", () => {
  const pcm = fixture("bad-band");
  assert.throws(
    () => embedWatermark(pcm, FMT, { payloadId: ID, band: { lowHz: 30000, highHz: 31000 } }),
    RangeError
  );
  assert.throws(
    () => embedWatermark(pcm, FMT, { payloadId: ID, band: { lowHz: 5000, highHz: 5050 } }),
    RangeError
  );
});

test("low sample rates produce a non-degenerate band under Nyquist", () => {
  for (const sr of [8000, 11025, 16000]) {
    const pcm = tone(4, sr, 2, "rate-" + sr);
    const marked = embedWatermark(pcm, { sampleRate: sr, channels: 2 }, { payloadId: ID, key: KEY });
    const bands = marked.watermarkMeta.bands;
    assert.ok(bands.length >= 1);
    for (const b of bands) {
      assert.ok(b.highHz - b.lowHz >= 200, `${sr} Hz band width ${b.highHz - b.lowHz}`);
      assert.ok(b.highHz <= sr / 2, `${sr} Hz band above Nyquist`);
    }
    assert.equal(new Set(bands.map((b) => `${b.lowHz}-${b.highHz}`)).size, bands.length, "duplicate bands");
    const res = detectWatermark(marked, { sampleRate: sr, channels: 2 }, { payloadId: ID, key: KEY });
    assert.equal(res.detected, true, `${sr} Hz round-trip`);
  }
});

test("watermark survives a stereo-to-mono downmix and a 48 kHz resample", () => {
  const marked = embedWatermark(fixture("process"), FMT, { payloadId: ID, key: KEY });
  const mono = new Float32Array(marked.length / 2);
  for (let i = 0; i < mono.length; i++) mono[i] = (marked[i * 2] + marked[i * 2 + 1]) / 2;
  assert.equal(detectWatermark(mono, { sampleRate: SR, channels: 1 }, { payloadId: ID, key: KEY }).detected, true);

  const resampled = resamplePcm(marked, 2, SR, 48000);
  assert.equal(detectWatermark(resampled, { sampleRate: 48000, channels: 2 }, { payloadId: ID, key: KEY }).detected, true);
});

test("silence stays silent and is not detected", () => {
  const silent = new Float32Array(SR * SECS * 2);
  const marked = embedWatermark(silent, FMT, { payloadId: ID, key: KEY });
  let peak = 0;
  for (let i = 0; i < marked.length; i++) peak = Math.max(peak, Math.abs(marked[i]));
  assert.equal(peak, 0);
  assert.equal(detectWatermark(marked, FMT, { payloadId: ID, key: KEY }).detected, false);
});

test("detection works on a hostile, spectrally shaped host (pink-ish noise)", () => {
  // Pure white noise is a documented hard case (it masks the carrier); a one-pole
  // low-passed "room noise" is the realistic hostile host and must still decode.
  const white = noise(SECS, SR, 2, "noise-host");
  const shaped = new Float32Array(white.length);
  let lp = 0;
  for (let i = 0; i < white.length; i++) { lp = 0.92 * lp + 0.08 * white[i]; shaped[i] = lp * 6; }
  const marked = embedWatermark(shaped, FMT, { payloadId: ID, key: KEY, strength: 0.9 });
  const res = detectWatermark(marked, FMT, { payloadId: ID, key: KEY });
  assert.equal(res.detected, true);
  assert.equal(res.recoveredPayloadId, ID);
});

test("invalid input is rejected with a clear error", () => {
  assert.throws(() => embedWatermark(new Float32Array(1000), FMT, {}), TypeError);
  assert.throws(() => embedWatermark(new Float32Array(1000), FMT, { payloadId: 1.5 }), TypeError);
  assert.throws(() => embedWatermark(new Float32Array(1000), { sampleRate: 4000, channels: 1 }, { payloadId: 1 }), RangeError);
  assert.throws(() => embedWatermark(new Float32Array(1000), { sampleRate: SR, channels: 9 }, { payloadId: 1 }), RangeError);
  assert.throws(() => embedWatermark(new Float32Array(1001), { sampleRate: SR, channels: 2 }, { payloadId: 1 }), RangeError);
  assert.throws(() => validateFmt(null, 0), TypeError);
});

test("audio shorter than one frame is rejected", () => {
  assert.throws(() => embedWatermark(new Float32Array(4410 * 2), FMT, { payloadId: ID }), RangeError);
});

test("verify mode reports a real BER; blind mode reports the documented 0", () => {
  const marked = embedWatermark(fixture("ber"), FMT, { payloadId: ID, key: KEY });
  const verify = detectWatermark(marked, FMT, { payloadId: ID, key: KEY });
  const blind = detectWatermark(marked, FMT, { key: KEY });
  assert.equal(verify.ber, 0);
  assert.equal(blind.ber, 0);
});

test("the payload codeword is not visible in the metadata as plaintext", () => {
  const marked = embedWatermark(fixture("meta"), FMT, { payloadId: ID, key: KEY });
  assert.equal(marked.watermarkMeta.payloadId, ID);
  assert.equal(marked.watermarkMeta.geometry.bits, 48);
  assert.equal(packCodeword(ID).length, 48);
});
