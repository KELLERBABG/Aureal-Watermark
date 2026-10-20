// 09: browser engine architecture — generated engine, page adapters, interoperability
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { execFileSync } from "node:child_process";
import { embedWatermark, detectWatermark, synthesizeSpeechLike } from "../src/index.js";

const checks = [];
const check = (name, pass, detail = "") => checks.push({ name, pass: !!pass, detail });

// ---------------------------------------------------------------- inline scripts parse
function extractScripts(file) {
  const html = readFileSync(file, "utf8");
  const out = [];
  const re = /<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) out.push(m[1]);
  return out;
}
for (const f of ["site/studio.html", "site/verifier.html", "site/index.html", "site/docs.html", "site/pricing.html"]) {
  extractScripts(f).forEach((code, i) => {
    let err = null;
    try { new vm.Script(code, { filename: `${f}#${i}` }); } catch (e) { err = e.message; }
    check(`${f} inline script #${i + 1} parses`, !err, err || `${code.length} chars`);
  });
}

// ---------------------------------------------------------------- no duplicated engine
for (const f of ["site/studio.html", "site/verifier.html"]) {
  const html = readFileSync(f, "utf8");
  check(`${f} loads the generated engine`, html.includes('<script src="/assets/aureal-engine.js"></script>'));
  check(`${f} contains no DSP constants of its own`,
    !/MAX_AMPLITUDE|MID_BAND_PERCEPTUAL_WEIGHT|BAND_PRESETS\s*=|function buildTemplate|Z_FULL\s*=/.test(html));
  check(`${f} no longer uses getDspWorker() as a value`, !/getDspWorker\(\)\s*\?/.test(html));
}

// ---------------------------------------------------------------- engine loads standalone
const engineSrc = readFileSync("assets/aureal-engine.js", "utf8");
const g = { console, Math, Float32Array, Float64Array, Int8Array, Int16Array, Uint8Array, Uint16Array, Uint32Array, DataView, ArrayBuffer, Map, Object, Array, Number, String, JSON, parseInt, parseFloat, isFinite, Error, RangeError, TypeError, Promise, setTimeout };
g.globalThis = g; g.window = g; g.self = g;
vm.createContext(g);
let engineErr = null;
try { vm.runInContext(engineSrc, g, { filename: "aureal-engine.js" }); } catch (e) { engineErr = e.message; }
check("assets/aureal-engine.js loads as a classic script", !engineErr, engineErr || `${engineSrc.length} bytes`);
const E = g.AurealEngine;
check("generated engine exposes embedWatermark/detectWatermark",
  !!E && typeof E.embedWatermark === "function" && typeof E.detectWatermark === "function");
check("generated engine uses the src mid band (4500–13500)",
  !!E && E.BAND_PRESETS.mid.lowHz === 4500 && E.BAND_PRESETS.mid.highHz === 13500, JSON.stringify(E && E.BAND_PRESETS));

let drift = "";
try { execFileSync(process.execPath, ["scripts/build-engine.js", "--check"], { stdio: "pipe" }); }
catch (e) { drift = String(e.stdout || e.stderr || e.message); }
check("generated engine is not stale (build-engine --check)", !drift, drift.split("\n")[0]);

// ---------------------------------------------------------------- page adapters
// Evaluate a page's inline script up to the first DOM access; the adapter functions are
// plain declarations, so they run headless with a fake `window`.
function loadAdapter(file) {
  const code = extractScripts(file)[0];
  let cut = code.length;
  for (const marker of ["\n  document.", "\n  const tabDetect", "\n  // --- Tab Interactivity"]) {
    const i = code.indexOf(marker);
    if (i > 0 && i < cut) cut = i;
  }
  const sandbox = { window: { AurealEngine: E }, AurealEngine: E, console, Math, Float32Array, Blob: class {}, fetch: () => Promise.reject(new Error("offline")) };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(`${code.slice(0, cut)}\n;globalThis.__adapter = { detectWatermarkCore, embedWatermarkCore, engineBandLabel };`, sandbox, { filename: file });
  return sandbox.__adapter;
}
const studioAdapter = loadAdapter("site/studio.html");
const verifierAdapter = loadAdapter("site/verifier.html");
check("studio adapter exposes the engine wrappers", !!(studioAdapter.detectWatermarkCore && studioAdapter.embedWatermarkCore));
check("verifier adapter exposes the engine wrappers", !!(verifierAdapter.detectWatermarkCore && verifierAdapter.embedWatermarkCore));

// ---------------------------------------------------------------- interoperability matrix
const SR = 44100, ID = 883921, KEY = "interop";
const mono = synthesizeSpeechLike({ seconds: 10, sampleRate: SR, channels: 1, seed: "interop" });
const st = new Float32Array(mono.length * 2);
for (let i = 0; i < mono.length; i++) { st[i * 2] = mono[i]; st[i * 2 + 1] = mono[i]; }
const FMT = { sampleRate: SR, channels: 2 };

const rows = [];
for (const band of ["high", "mid", "dual"]) {
  const coreMarked = embedWatermark(st, FMT, { payloadId: ID, key: KEY, band });
  const pageMarked = studioAdapter.embedWatermarkCore(st, FMT, { payloadId: ID, key: KEY, band });
  let identical = coreMarked.length === pageMarked.length;
  if (identical) for (let i = 0; i < coreMarked.length; i++) if (coreMarked[i] !== pageMarked[i]) { identical = false; break; }

  const detectors = {
    "src core": () => detectWatermark(coreMarked, FMT, { payloadId: ID, key: KEY }),
    "studio adapter": () => studioAdapter.detectWatermarkCore(coreMarked, FMT, { payloadId: ID, key: KEY, band: "auto" }),
    "verifier adapter": () => verifierAdapter.detectWatermarkCore(coreMarked, FMT, { payloadId: ID, key: KEY, band: "auto" }),
  };
  for (const [name, fn] of Object.entries(detectors)) {
    const r = fn();
    rows.push({ band, beat: "core", detector: name, det: r.detected, id: r.recoveredPayloadId, conf: +(r.confidence ?? 0).toFixed(2) });
  }
  const r2 = detectWatermark(pageMarked, FMT, { payloadId: ID, key: KEY });
  rows.push({ band, beat: "studio", detector: "src core", det: r2.detected, id: r2.recoveredPayloadId, conf: +r2.confidence.toFixed(2) });
  check(`studio embed (${band}) is bit-identical to the src engine`, identical);
}

console.log("EMBEDDER".padEnd(10) + "DETECTOR".padEnd(20) + "BAND".padEnd(6) + "DETECT  ID      CONF");
let comboFails = 0;
for (const r of rows) {
  const ok = r.det === true && r.id === ID;
  if (!ok) comboFails++;
  console.log(`${r.beat.padEnd(10)}${r.detector.padEnd(20)}${r.band.padEnd(6)}${String(r.det).padEnd(8)}${String(r.id).padEnd(8)}${r.conf}`);
}
check("all 12 interoperability combinations detect the ID", comboFails === 0, `${comboFails} failed`);

let bad = 0;
for (const c of checks) { if (!c.pass) bad++; console.log(`${c.pass ? "PASS" : "FAIL"}  ${c.name}${c.detail ? "  [" + c.detail + "]" : ""}`); }
console.log(`\n${checks.length - bad}/${checks.length} passed`);
