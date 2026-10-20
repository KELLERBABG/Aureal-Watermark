import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { runCli, tempDir } from "./helpers.js";

function spawnOnce(script, args, cwd, timeout) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(process.cwd(), "scripts", script), ...args], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "", stderr = "";
    // Hard timeout: a hung child must fail the test, not stall the CI job forever.
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ code: "timeout", stdout, stderr: stderr + "\n[test harness] killed after " + timeout + "ms" });
    }, timeout);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
    child.on("error", (err) => { clearTimeout(timer); resolve({ code: "error", stdout, stderr: stderr + err.message }); });
  });
}

/**
 * These scripts are read-only and idempotent, so a single retry is safe. It absorbs the
 * rare OS-level stall (process spawn / AV file scan) that can otherwise trip the timeout
 * when `node --test` runs every file in parallel. A genuinely broken script fails twice.
 */
async function runScript(script, args, cwd, timeout = 90000) {
  const first = await spawnOnce(script, args, cwd, timeout);
  if (first.code !== "timeout") return first;
  await new Promise((r) => setTimeout(r, 500));
  return spawnOnce(script, args, cwd, timeout);
}

async function distribute(dir) {
  await runCli(["gen", "master.wav", "--seconds", "6", "--channels", "2"], { cwd: dir });
  const batch = await runScript(
    "batch_distribute.js",
    ["master.wav", "--recipients", "Alice,Bob,Carol", "--out-dir", "promos", "--key", "promo-key"],
    dir
  );
  assert.equal(batch.code, 0, batch.stderr);
  return join(dir, "promos", "recipients.json");
}

test("batch_distribute writes a manifest with the key and no phantom Tardos data", { timeout: 120000 }, async () => {
  const { dir, cleanup } = tempDir();
  try {
    const manifestPath = await distribute(dir);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    assert.equal(manifest.key, "promo-key");
    assert.equal(manifest.keyDefault, false);
    assert.equal(manifest.recipients.length, 3);
    assert.equal(manifest.tardos, undefined, "no Tardos metadata is written");
    for (const r of manifest.recipients) {
      assert.equal(typeof r.id, "number");
      assert.match(r.sha256, /^[0-9a-f]{64}$/);
      assert.equal(r.tardosCodeword, undefined);
    }
    assert.equal(readdirSync(join(dir, "promos")).filter((f) => f.endsWith(".wav")).length, 3);
  } finally {
    cleanup();
  }
});

test("audit_leak identifies the recipient without needing --key (manifest carries it)", { timeout: 120000 }, async () => {
  const { dir, cleanup } = tempDir();
  try {
    await distribute(dir);
    const audit = await runScript("audit_leak.js", ["promos/master_[Bob].wav", "--manifest", "promos/recipients.json"], dir);
    assert.equal(audit.code, 0, audit.stdout + audit.stderr);
    assert.match(audit.stdout, /Recovered ID/);
    assert.match(audit.stdout, /Recipient Name:\s+Bob/);
    assert.match(audit.stdout, /VERDICT: Recovered ID matches recipient "Bob"/);

    const json = await runScript("audit_leak.js", ["promos/master_[Carol].wav", "--manifest", "promos/recipients.json", "--json"], dir);
    const parsed = JSON.parse(json.stdout);
    assert.equal(parsed.leakMatch.name, "Carol");
  } finally {
    cleanup();
  }
});

test("a plain copy that was never distributed is not attributed", { timeout: 120000 }, async () => {
  const { dir, cleanup } = tempDir();
  try {
    await distribute(dir);
    const audit = await runScript("audit_leak.js", ["master.wav", "--manifest", "promos/recipients.json"], dir);
    assert.equal(audit.code, 1);
    assert.match(audit.stdout, /NO WATERMARK DETECTED/);
  } finally {
    cleanup();
  }
});
