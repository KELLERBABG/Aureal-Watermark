// test/cli.test.js — end-to-end CLI smoke test: gen -> embed -> detect.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const cli = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "auralwatermark.js");
const work = mkdtempSync(join(tmpdir(), "aw-cli-"));

function run(args) {
  const r = spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  return {
    status: r.status,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
  };
}

test.after(() => {
  try {
    rmSync(work, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

test("gen creates a wav file", () => {
  const out = join(work, "tone.wav");
  const r = run(["gen", out, "--seconds", "6", "--rate", "48000"]);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(out));
  // 6s * 48000 * 2 bytes + header
  assert.equal(statSync(out).size, 44 + 6 * 48000 * 2);
});

test("embed writes watermarked copy of same size", () => {
  const inp = join(work, "tone.wav");
  const out = join(work, "marked.wav");
  const r = run(["embed", inp, out, "--id", "8675309", "--key", "demo-secret"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /id=8675309/);
  assert.ok(existsSync(out));
  assert.equal(statSync(out).size, statSync(inp).size);
});

test("detect with correct id exits 0 and reports YES", () => {
  const r = run(["detect", join(work, "marked.wav"), "--id", "8675309", "--key", "demo-secret"]);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.match(r.stdout, /detected:\s*YES/);
  assert.match(r.stdout, /ber:\s*0\.0%/);
});

test("detect with wrong id exits 1 and reports NO (rejection works)", () => {
  const r = run(["detect", join(work, "marked.wav"), "--id", "1111111", "--key", "demo-secret"]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /detected:\s*NO/);
});

test("blind detect (no --id) recovers the embedded id via CRC", () => {
  const r = run(["detect", join(work, "marked.wav"), "--key", "demo-secret"]);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.match(r.stdout, /detected:\s*YES/);
  assert.match(r.stdout, /recovered id:\s*8675309/);
});

test("detect with wrong key exits 1", () => {
  const r = run(["detect", join(work, "marked.wav"), "--id", "8675309", "--key", "wrong-key"]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /detected:\s*NO/);
});

test("unwatermarked file is not detected", () => {
  const r = run(["detect", join(work, "tone.wav"), "--id", "8675309", "--key", "demo-secret"]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /detected:\s*NO/);
});
