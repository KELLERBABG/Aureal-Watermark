// Band selector contract: presets, custom objects, "low:high" strings.
// Guards the regression where a custom band was silently replaced by the
// default dual-band configuration.

import test from "node:test";
import assert from "node:assert/strict";

import { bandList, resolveBand, BAND_PRESETS } from "../src/signal.js";
import { embedWatermark, detectWatermark } from "../src/index.js";
import { synthesizeSpeechLike } from "../src/synth.js";

test("high and mid presets resolve to their documented ranges", () => {
  assert.deepEqual(bandList("high", 48000), [resolveBand("high", 48000)]);
  assert.deepEqual(bandList("mid", 48000), [resolveBand("mid", 48000)]);
  assert.deepEqual(resolveBand("high", 48000), { lowHz: 17000, highHz: 19500, centerHz: 18250 });
  assert.deepEqual(resolveBand("mid", 48000), { lowHz: 4500, highHz: 13500, centerHz: 9000 });
  assert.deepEqual(BAND_PRESETS.high, { lowHz: 17000, highHz: 19500 });
});

test("dual, auto and undefined expand to both bands", () => {
  const dual = bandList("dual", 48000);
  assert.equal(dual.length, 2);
  assert.deepEqual(dual[0], resolveBand("high", 48000));
  assert.deepEqual(dual[1], resolveBand("mid", 48000));
  assert.deepEqual(bandList("auto", 48000), dual);
  assert.deepEqual(bandList(undefined, 48000), dual);
});

test("custom band objects select exactly one custom band", () => {
  assert.deepEqual(bandList({ lowHz: 9000, highHz: 11000 }, 48000), [
    { lowHz: 9000, highHz: 11000, centerHz: 10000 }
  ]);
});

test("'low:high' and 'low-high' strings select exactly one custom band", () => {
  assert.deepEqual(bandList("9000:11000", 48000), [
    { lowHz: 9000, highHz: 11000, centerHz: 10000 }
  ]);
  assert.deepEqual(bandList("9000-11000", 48000), [
    { lowHz: 9000, highHz: 11000, centerHz: 10000 }
  ]);
});

test("resolveBand clamps frequencies into the Nyquist-safe range", () => {
  const clamped = resolveBand({ lowHz: 10, highHz: 40000 }, 48000);
  assert.equal(clamped.lowHz, 1000);
  assert.equal(clamped.highHz, 23900);
  assert.throws(() => resolveBand({ lowHz: "nope", highHz: 9000 }, 48000), /band\.lowHz must be a finite number/);
});

test("embed and detect round-trip on a custom band", () => {
  const fmt = { sampleRate: 48000, channels: 1 };
  const samples = synthesizeSpeechLike({ seconds: 5, sampleRate: 48000, channels: 1 });
  const marked = embedWatermark(samples, fmt, { payloadId: 0x0badf00d, key: "band-key", band: "9000:11000", strength: 0.6 });

  assert.equal(marked.watermarkMeta.bands.length, 1);
  assert.equal(marked.watermarkMeta.bands[0].lowHz, 9000);
  assert.equal(marked.watermarkMeta.bands[0].highHz, 11000);

  const detect = detectWatermark(marked, fmt, { key: "band-key", payloadId: 0x0badf00d, band: "9000:11000" });
  assert.equal(detect.detected, true);
  assert.equal(detect.recoveredPayloadId, 0x0badf00d);
  assert.equal(detect.details.bandUsed.lowHz, 9000);
  assert.equal(detect.details.bandUsed.highHz, 11000);
  assert.equal(detect.details.bandsTried, 1);
});
