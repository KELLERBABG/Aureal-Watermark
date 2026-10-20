import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runCli, tempDir } from "./helpers.js";

const ROOT = process.cwd();

test("--help documents the commands and exit codes", async () => {
  const { code, stdout } = await runCli(["--help"]);
  assert.equal(code, 0);
  for (const cmd of ["gen", "embed", "detect", "license", "verify-report"]) {
    assert.match(stdout, new RegExp(cmd));
  }
  assert.match(stdout, /Exit codes/);
});

test("unknown commands and bad flags exit 2", async () => {
  assert.equal((await runCli(["frobnicate"])).code, 2);
  assert.equal((await runCli(["embed", "a.wav"])).code, 2);
  assert.equal((await runCli(["gen"])).code, 2);
  assert.equal((await runCli(["detect", "does-not-exist.wav"])).code, 2);
  assert.equal((await runCli(["gen", "x.wav", "--bits", "12"])).code, 2);
});

test("gen -> embed -> detect round-trip with exit codes 0/0/0", async () => {
  const { dir, cleanup } = tempDir();
  try {
    assert.equal((await runCli(["gen", "in.wav", "--seconds", "5"], { cwd: dir })).code, 0);
    const embed = await runCli(["embed", "in.wav", "out.wav", "--id", "424242", "--key", "cli-key"], { cwd: dir });
    assert.equal(embed.code, 0, embed.stderr);
    assert.match(embed.stdout, /id=424242/);
    const detect = await runCli(["detect", "out.wav", "--id", "424242", "--key", "cli-key"], { cwd: dir });
    assert.equal(detect.code, 0, detect.stderr);
    assert.match(detect.stdout, /detected: YES/);
  } finally {
    cleanup();
  }
});

test("detect exits 1 when the watermark is absent or the key is wrong", async () => {
  const { dir, cleanup } = tempDir();
  try {
    await runCli(["gen", "in.wav", "--seconds", "5"], { cwd: dir });
    await runCli(["embed", "in.wav", "out.wav", "--id", "424242", "--key", "cli-key"], { cwd: dir });
    assert.equal((await runCli(["detect", "in.wav", "--id", "424242"], { cwd: dir })).code, 1);
    assert.equal((await runCli(["detect", "out.wav", "--id", "424242", "--key", "nope"], { cwd: dir })).code, 1);
  } finally {
    cleanup();
  }
});

test("--band lowHz:highHz is honoured (not silently replaced by dual)", async () => {
  const { dir, cleanup } = tempDir();
  try {
    await runCli(["gen", "in.wav", "--seconds", "5"], { cwd: dir });
    const res = await runCli(["embed", "in.wav", "out.wav", "--id", "7", "--band", "12000:14000"], { cwd: dir });
    assert.equal(res.code, 0, res.stderr);
    assert.match(res.stdout, /12000-14000|12000:14000|band/);
    assert.doesNotMatch(res.stdout, /band dual/);
    const detect = await runCli(["detect", "out.wav", "--id", "7", "--band", "12000:14000"], { cwd: dir });
    assert.equal(detect.code, 0, detect.stderr);
  } finally {
    cleanup();
  }
});

test("--json emits a single valid JSON document with the documented fields", async () => {
  const { dir, cleanup } = tempDir();
  try {
    await runCli(["gen", "in.wav", "--seconds", "5"], { cwd: dir });
    await runCli(["embed", "in.wav", "out.wav", "--id", "424242", "--key", "jk"], { cwd: dir });
    const res = await runCli(["detect", "out.wav", "--key", "jk", "--json"], { cwd: dir });
    assert.equal(res.code, 0, res.stderr);
    const parsed = JSON.parse(res.stdout);
    assert.equal(parsed.detected, true);
    assert.equal(parsed.recoveredPayloadId, 424242);
    assert.equal(typeof parsed.confidence, "number");
    assert.equal(parsed.details.bits, 48);
    assert.equal(parsed.details.softSymbols.length, 48);
  } finally {
    cleanup();
  }
});

test("--report + --report-txt produce a verifiable certificate that fails after tampering", async () => {
  const { dir, cleanup } = tempDir();
  try {
    await runCli(["gen", "in.wav", "--seconds", "5"], { cwd: dir });
    await runCli(["embed", "in.wav", "out.wav", "--id", "424242", "--key", "rk"], { cwd: dir });
    const res = await runCli(["detect", "out.wav", "--id", "424242", "--key", "rk", "--report", "proof.json", "--report-txt", "cert.txt"], { cwd: dir });
    assert.equal(res.code, 0, res.stderr);

    const valid = await runCli(["verify-report", "proof.json", "--key", "rk"], { cwd: dir });
    assert.equal(valid.code, 0, valid.stdout + valid.stderr);
    assert.match(valid.stdout, /SEAL VALID/);
    assert.match(readFileSync(join(dir, "cert.txt"), "utf8"), /REPORT INTEGRITY SEAL/);

    assert.equal((await runCli(["verify-report", "proof.json", "--key", "wrong"], { cwd: dir })).code, 1);

    const proofPath = join(dir, "proof.json");
    const proof = JSON.parse(readFileSync(proofPath, "utf8"));
    proof.verification.recoveredPayloadId = 1;
    writeFileSync(proofPath, JSON.stringify(proof, null, 2));
    const tampered = await runCli(["verify-report", "proof.json", "--key", "rk"], { cwd: dir });
    assert.equal(tampered.code, 1);
    assert.match(tampered.stdout, /SEAL INVALID/);
  } finally {
    cleanup();
  }
});

test("verify-report errors cleanly on a missing or malformed file", async () => {
  const { dir, cleanup } = tempDir();
  try {
    assert.equal((await runCli(["verify-report", "nope.json"], { cwd: dir })).code, 2);
    writeFileSync(join(dir, "bad.json"), "{not json");
    assert.equal((await runCli(["verify-report", "bad.json"], { cwd: dir })).code, 2);
  } finally {
    cleanup();
  }
});

test("licence status is read from the user home and does not crash when absent", async () => {
  const { dir, cleanup } = tempDir();
  try {
    const res = await runCli(["license"], { cwd: dir, env: { USERPROFILE: dir, HOME: dir } });
    assert.equal(res.code, 0, res.stderr);
    assert.match(res.stdout, /COMMUNITY EVALUATION/);
  } finally {
    cleanup();
  }
});

test("a stored licence is reported as active and shown on embed", async () => {
  const { dir, cleanup } = tempDir();
  try {
    const home = join(dir, "home");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(join(home, ".aureal"), { recursive: true });
    writeFileSync(
      join(home, ".aureal", "license.json"),
      JSON.stringify({ status: "active", displayKey: "****-TESTKEY1", customerEmail: "buyer@example.com", activatedAt: new Date().toISOString(), expiresAt: null })
    );
    const env = { USERPROFILE: home, HOME: home };
    const status = await runCli(["license"], { cwd: dir, env });
    assert.equal(status.code, 0, status.stderr);
    assert.match(status.stdout, /Status:\s+ACTIVE/);

    await runCli(["gen", "in.wav", "--seconds", "4"], { cwd: dir, env });
    const embed = await runCli(["embed", "in.wav", "out.wav", "--id", "5"], { cwd: dir, env });
    assert.match(embed.stdout, /Commercial Pro/);
  } finally {
    cleanup();
  }
});

test("the CLI reads the version from one place", async () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const { stdout } = await runCli(["--help"]);
  assert.ok(stdout.includes(pkg.version), `help mentions ${pkg.version}`);
});
