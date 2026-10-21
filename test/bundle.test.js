// test/bundle.test.js — the zero-dependency single-file build must run standalone.
// This is what the GitHub release pipeline ships as dist/aureal-watermark.cjs and
// compiles into the Windows/Linux/macOS binaries, so it gets its own E2E pass.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const bundleScript = join(root, "scripts", "bundle.js");
const bundleFile = join(root, "dist", "cli.cjs");
const work = mkdtempSync(join(tmpdir(), "aw-bundle-"));

function run(bin, args, options = {}) {
  const r = spawnSync(bin, args, {
    encoding: "utf8",
    cwd: root,
    timeout: 120000,
    windowsHide: true,
    ...options
  });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

test.before(() => {
  const build = run(process.execPath, [bundleScript]);
  assert.equal(build.status, 0, `bundle build failed:\n${build.stdout}\n${build.stderr}`);
});

test.after(() => {
  rmSync(work, { recursive: true, force: true });
});

test("build produces a single self-contained CommonJS file", () => {
  assert.ok(existsSync(bundleFile), "dist/cli.cjs must exist");
  assert.ok(statSync(bundleFile).size > 300_000, "bundle should contain inlined studio HTML and assets");

  const source = readFileSync(bundleFile, "utf8");
  assert.doesNotMatch(source, /(^|\n)import\s+/, "bundle must not contain ESM imports");
  assert.doesNotMatch(source, /(^|\n)export\s+/, "bundle must not contain ESM exports");
  assert.match(source, /require\("node:child_process"\)/);
  assert.match(source, /execFileSync/, "ffmpeg must be invoked with an argument vector");
  assert.match(source, /const path = require\("node:path"\)/, "license module uses the path namespace");
  assert.match(source, /WATERMARK ID MATCH/, "studio HTML must be inlined");
  assert.match(source, /Buffer\.from\(/, "icons must be inlined as base64");

  const check = run(process.execPath, ["--check", bundleFile]);
  assert.equal(check.status, 0, `bundled file has a syntax error:\n${check.stderr}`);
});

test("bundled CLI serves version, help, and license status", () => {
  const version = run(process.execPath, [bundleFile, "version"]);
  assert.equal(version.status, 0, version.stderr);
  assert.match(version.stdout, /Aureal Watermark v\d+\.\d+\.\d+/);

  const help = run(process.execPath, [bundleFile, "--help"]);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /auralwatermark embed/);

  const license = run(process.execPath, [bundleFile, "license"]);
  assert.equal(license.status, 0, license.stderr);
  assert.match(license.stdout, /=== Aureal License Status ===/);
  assert.match(license.stdout, /ACTIVE|COMMUNITY EVALUATION/);
});

test("bundled CLI gen -> embed -> detect round trip", () => {
  const inp = join(work, "bundle-tone.wav");
  const marked = join(work, "bundle-marked.wav");

  const gen = run(process.execPath, [bundleFile, "gen", inp, "--seconds", "6", "--rate", "48000", "--channels", "2", "--bits", "24"]);
  assert.equal(gen.status, 0, gen.stderr);

  const embed = run(process.execPath, [bundleFile, "embed", inp, marked, "--id", "271828", "--key", "bundle-key", "--strength", "0.6"]);
  assert.equal(embed.status, 0, embed.stderr);
  assert.match(embed.stdout, /id=271828/);

  const detect = run(process.execPath, [bundleFile, "detect", marked, "--id", "271828", "--key", "bundle-key", "--json"]);
  assert.equal(detect.status, 0, detect.stderr || detect.stdout);
  const result = JSON.parse(detect.stdout);
  assert.equal(result.detected, true);
  assert.equal(result.recoveredPayloadId, 271828);

  const wrong = run(process.execPath, [bundleFile, "detect", marked, "--id", "1", "--key", "bundle-key"]);
  assert.equal(wrong.status, 1, "wrong expected id must exit 1");
});

test("bundled CLI writes forensic reports", () => {
  const inp = join(work, "bundle-tone.wav");
  const marked = join(work, "bundle-marked.wav");
  const reportJson = join(work, "bundle-proof.json");
  const reportTxt = join(work, "bundle-proof.txt");

  const embed = run(process.execPath, [bundleFile, "embed", inp, marked, "--id", "161803", "--key", "bundle-key"]);
  assert.equal(embed.status, 0, embed.stderr);

  const detect = run(process.execPath, [
    bundleFile, "detect", marked, "--id", "161803", "--key", "bundle-key",
    "--report", reportJson, "--report-txt", reportTxt
  ]);
  assert.equal(detect.status, 0, detect.stderr || detect.stdout);
  assert.ok(existsSync(reportJson));
  assert.ok(existsSync(reportTxt));
  const proof = JSON.parse(readFileSync(reportJson, "utf8"));
  assert.equal(proof.verification.status, "WATERMARK_ID_MATCH");
  assert.equal(proof.verification.recoveredPayloadId, 161803);
  assert.match(readFileSync(reportTxt, "utf8"), /WATERMARK_ID_MATCH/);
});
