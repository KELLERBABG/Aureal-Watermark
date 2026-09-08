import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");

test("license records never persist a full key", () => {
  const source = read("src/license.js");
  assert.match(source, /delete safeRecord\.key/);
  assert.match(source, /&& !parsed\.key/);
});

test("studio license modal exposes accessible dialog semantics", () => {
  const source = read("demo/studio.html");
  assert.match(source, /role="dialog"/);
  assert.match(source, /aria-modal="true"/);
  assert.match(source, /aria-live="polite"/);
  assert.match(source, /e\.key === "Escape"/);
  assert.match(source, /e\.key === "Tab"/);
});

test("landing page keeps claims and navigation regression-safe", () => {
  const source = read("demo/index.html");
  assert.doesNotMatch(source, /�|â|â|ð/);
  assert.match(source, /nav-toggle/);
  assert.match(source, /scanDurationMs/);
  assert.match(source, /Live In-Browser Demo/);
  assert.doesNotMatch(source, /WATERMARK VERIFIED/);
});
