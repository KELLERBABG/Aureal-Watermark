// Type contract: every value exported by the runtime must be declared in
// types/index.d.ts, and the declarations must describe the real shapes.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const indexSource = readFileSync(join(ROOT, "src", "index.js"), "utf8");
const typeSource = readFileSync(join(ROOT, "types", "index.d.ts"), "utf8");

function runtimeExports(source) {
  const names = new Set();
  for (const match of source.matchAll(/export\s*\{([^}]+)\}\s*from/g)) {
    for (const part of match[1].split(",")) {
      const name = part.trim().split(/\s+as\s+/).pop().trim();
      if (name) names.add(name);
    }
  }
  for (const match of source.matchAll(/export\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z0-9_$]+)/g)) {
    names.add(match[1]);
  }
  return names;
}

function declaredNames(source) {
  const names = new Set();
  for (const match of source.matchAll(
    /^export\s+(?:declare\s+)?(?:function|const|let|class|interface|type)\s+([A-Za-z0-9_$]+)/gm
  )) {
    names.add(match[1]);
  }
  return names;
}

function declaredValueNames(source) {
  const names = new Set();
  for (const match of source.matchAll(/^export\s+(?:declare\s+)?(?:function|const|let|class)\s+([A-Za-z0-9_$]+)/gm)) {
    names.add(match[1]);
  }
  return names;
}

test("types/index.d.ts declares every runtime export", () => {
  const declared = declaredNames(typeSource);
  const missing = [...runtimeExports(indexSource)].filter((name) => !declared.has(name)).sort();
  assert.deepEqual(missing, [], `missing declarations: ${missing.join(", ")}`);
});

test("types/index.d.ts does not declare phantom runtime values", () => {
  const runtime = runtimeExports(indexSource);
  const phantom = [...declaredValueNames(typeSource)].filter((name) => !runtime.has(name)).sort();
  assert.deepEqual(phantom, [], `declared but not exported at runtime: ${phantom.join(", ")}`);
});

test("declarations match the implemented signatures", () => {
  const expect = (pattern, message) => assert.match(typeSource, pattern, message);

  expect(/crc16\(bytes: ArrayLike<number>\): number;/,
    "crc16 takes a byte sequence, not a payload id");
  expect(/unpackCodeword\(symbols: ArrayLike<number>\): \{\s*id: number;\s*crcOk: boolean;\s*\};/,
    "unpackCodeword returns { id, crcOk }");
  expect(/getLicenseStatus\(\): LicenseStatus;/,
    "getLicenseStatus returns the offline LicenseStatus shape");
  expect(/saveLocalLicense\(record: LocalLicenseRecord\): void;/,
    "saveLocalLicense takes the cached licence record and does not report a boolean");
  expect(/crcOk: boolean;/, "DetectionResult exposes crcOk");
  expect(/reps: number;/, "DetectionResult exposes the folded repetition count");
  expect(/amplitude: number;/, "DetectionResult exposes the aligned amplitude");
  expect(/generateTardosCodebook/, "Tardos codebook generator is declared");
  expect(/accuseCoalition/, "Tardos accusation API is declared");
  expect(/export class WavError extends Error \{\}/, "WavError is declared as a class");
});
