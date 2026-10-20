import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { execFileSync } from "node:child_process";
import { embedWatermark, detectWatermark } from "../src/index.js";
import { tone } from "./helpers.js";

test("the generated browser engine is in sync with src/", () => {
  execFileSync(process.execPath, ["scripts/build-engine.js", "--check"], { stdio: "pipe" });
});

test("the generated engine loads as a classic script and exposes the API", () => {
  const source = readFileSync("assets/aureal-engine.js", "utf8");
  const sandbox = { Math, Float32Array, Float64Array, Int8Array, Int16Array, Uint8Array, Uint16Array, Uint32Array, DataView, ArrayBuffer, Map, Object, Array, Number, String, JSON, parseInt, parseFloat, isFinite, Error, RangeError, TypeError, console };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: "aureal-engine.js" });
  assert.ok(sandbox.AurealEngine, "AurealEngine global");
  for (const fn of ["embedWatermark", "detectWatermark", "resamplePcm", "validateFmt", "packCodeword", "unpackCodeword", "crc16"]) {
    assert.equal(typeof sandbox.AurealEngine[fn], "function", fn);
  }
  assert.equal(sandbox.AurealEngine.BAND_PRESETS.mid.lowHz, 4500);
});

test("the web pages do not carry their own copy of the DSP engine", () => {
  for (const file of ["site/studio.html", "site/verifier.html"]) {
    const html = readFileSync(file, "utf8");
    assert.ok(html.includes('<script src="/assets/aureal-engine.js"></script>'), `${file} loads the engine`);
    assert.doesNotMatch(html, /MAX_AMPLITUDE|MID_BAND_PERCEPTUAL_WEIGHT|function buildTemplate/, `${file} has no engine copy`);
  }
  assert.ok(readFileSync("site/index.html", "utf8").includes('<script src="/assets/aureal-engine.js"></script>'));
});

test("the generated engine and src/ are bit-identical at embed time", () => {
  const html = readFileSync("site/studio.html", "utf8");
  const script = /<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/.exec(html)[1];
  let cut = script.length;
  for (const marker of ["\n  document.", "\n  const tabDetect"]) {
    const i = script.indexOf(marker);
    if (i > 0 && i < cut) cut = i;
  }
  const sandbox = { window: {}, console, Math, Float32Array, Blob: class {}, fetch: () => Promise.reject(new Error("offline")) };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(readFileSync("assets/aureal-engine.js", "utf8"), sandbox, { filename: "engine" });
  sandbox.window.AurealEngine = sandbox.AurealEngine;
  vm.runInContext(`${script.slice(0, cut)}\n;globalThis.__a = { embedWatermarkCore, detectWatermarkCore };`, sandbox, { filename: "studio" });

  const SR = 44100;
  const pcm = tone(6, SR, 2, "interop");
  const fmt = { sampleRate: SR, channels: 2 };
  for (const band of ["high", "mid", "dual"]) {
    const mine = embedWatermark(pcm, fmt, { payloadId: 1234, key: "k", band });
    const theirs = sandbox.__a.embedWatermarkCore(pcm, fmt, { payloadId: 1234, key: "k", band });
    assert.deepEqual(Array.from(theirs), Array.from(mine), `embed (${band})`);
    const res = detectWatermark(theirs, fmt, { payloadId: 1234, key: "k" });
    assert.equal(res.detected, true, `detect (${band})`);
    assert.equal(res.recoveredPayloadId, 1234);
  }
});

test("every inline page script parses (no dead pages)", () => {
  for (const file of ["site/studio.html", "site/verifier.html", "site/index.html", "site/docs.html", "site/pricing.html"]) {
    const html = readFileSync(file, "utf8");
    const re = /<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g;
    let m, i = 0;
    while ((m = re.exec(html))) {
      i++;
      assert.doesNotThrow(() => new vm.Script(m[1], { filename: `${file}#${i}` }), `${file} script ${i}`);
    }
  }
});
