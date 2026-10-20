// scripts/build-engine.js — generate the browser DSP bundle from src/.
//
// The Web Studio, the Verifier page and the landing-page demo all need the same DSP
// engine as the CLI/API. Instead of maintaining hand-written copies (which drifted:
// different band presets, amplitudes and detection thresholds), this script emits
// `assets/aureal-engine.js` straight from the canonical modules in `src/` and exposes
// them on `globalThis.AurealEngine`.
//
// `node scripts/build-engine.js --check` exits 1 if the file on disk is stale, so CI
// (via `npm run sync:site:check`) fails instead of letting the copies drift again.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(root, "assets", "aureal-engine.js");

const HEADER = `// assets/aureal-engine.js — GENERATED FILE, DO NOT EDIT.
//
// Written by scripts/build-engine.js from the canonical modules in src/.
// Run \`node scripts/build-engine.js\` after changing any of:
//   src/signal.js, src/payload.js, src/resample.js, src/embed.js, src/detect.js
// CI runs \`node scripts/build-engine.js --check\` and fails if this file is stale.

(function (global) {
  "use strict";
`;

const FOOTER = `
  global.AurealEngine = Object.freeze({
    embedWatermark,
    detectWatermark,
    resamplePcm,
    validateFmt,
    packCodeword,
    unpackCodeword,
    crc16,
    DEFAULT_KEY,
    DEFAULT_BAND,
    BAND_PRESETS,
    BITS_PER_CODEWORD,
  });
})(typeof globalThis !== "undefined" ? globalThis : self);
`;

/** Remove ESM syntax so the module body can run as a classic script. */
function stripModuleSyntax(code) {
  return code
    .replace(/^import\s+[\s\S]*?from\s+["'][^"']+["'];?[ \t]*$/gm, "")
    .replace(/^export\s*\{[^}]*\}\s*from\s*["'][^"']+["'];?[ \t]*$/gm, "")
    .replace(/^export\s*\{[^}]*\};?[ \t]*$/gm, "")
    .replace(/^export\s+default\s+/gm, "")
    .replace(/^export\s+(async\s+)?function\s+/gm, "$1function ")
    .replace(/^export\s+class\s+/gm, "class ")
    .replace(/^export\s+const\s+/gm, "const ")
    .replace(/^export\s+let\s+/gm, "let ")
    .replace(/^export\s+var\s+/gm, "var ")
    .trim();
}

/** Keep only the parts of a module the browser bundle needs. */
const MODULES = ["signal.js", "payload.js", "resample.js", "embed.js", "detect.js"];

const pieces = [];
// A single shared default key (embed.js and detect.js each declared their own copy).
pieces.push('const DEFAULT_KEY = "aural-watermark-default-key";');

for (const name of MODULES) {
  // Normalise line endings first so the generated file is identical on every OS.
  const code = stripModuleSyntax(readFileSync(join(root, "src", name), "utf8").replace(/\r\n/g, "\n"));
  const cleaned = code.replace(/^const DEFAULT_KEY = [^;]+;[ \t]*$/gm, "").trim();
  pieces.push(`\n// ---- src/${name} ----\n${cleaned}`);
}

const body = HEADER + pieces.join("\n") + "\n" + FOOTER;
const current = existsSync(OUT) ? readFileSync(OUT, "utf8") : null;
// Compare without line-ending sensitivity: a Windows checkout may materialise the
// generated file as CRLF even though this script writes LF.
const normalize = (text) => (text === null ? null : text.replace(/\r\n/g, "\n"));

if (process.argv.includes("--check")) {
  if (normalize(current) === normalize(body)) {
    console.log("ok      assets/aureal-engine.js is up to date");
  } else {
    console.error("DRIFT: assets/aureal-engine.js differs from src/. Run `node scripts/build-engine.js` and commit the result.");
    process.exit(1);
  }
} else {
  writeFileSync(OUT, body, "utf8");
  console.log(`wrote assets/aureal-engine.js (${body.length} bytes) from ${MODULES.length} src modules`);
}
