// test/helpers.js — deterministic fixtures shared by the test suite.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

/** Deterministic pseudo-random generator (mulberry32). */
export function rng(seed = "seed") {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Simple musical test signal: harmonic stack with an amplitude envelope. */
export function tone(seconds, sampleRate, channels = 1, seed = "tone") {
  const n = Math.round(seconds * sampleRate);
  const r = rng(seed);
  const f0 = 110 + r() * 110;
  const out = new Float32Array(n * channels);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const env = 0.55 + 0.45 * Math.sin(2 * Math.PI * 0.37 * t);
    const v = (0.5 * Math.sin(2 * Math.PI * f0 * t)
      + 0.28 * Math.sin(2 * Math.PI * f0 * 2 * t)
      + 0.14 * Math.sin(2 * Math.PI * f0 * 3 * t)
      + 0.06 * Math.sin(2 * Math.PI * f0 * 5 * t)) * env * 0.7;
    for (let c = 0; c < channels; c++) out[i * channels + c] = v;
  }
  return out;
}

/** Broadband noise, useful as a hostile host signal. */
export function noise(seconds, sampleRate, channels = 1, seed = "noise") {
  const n = Math.round(seconds * sampleRate);
  const r = rng(seed);
  const out = new Float32Array(n * channels);
  for (let i = 0; i < n * channels; i++) out[i] = r() * 1.2 - 0.6;
  return out;
}

export function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), "aureal-test-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** Run the CLI and capture stdout/stderr/exit code. */
export function runCli(args, { cwd, env, timeout = 120000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(process.cwd(), "bin", "auralwatermark.js"), ...args], {
      cwd: cwd ?? process.cwd(),
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => child.kill(), timeout);
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}

/** Start the REST microservice on an ephemeral port and wait for health. */
/**
 * Start the REST microservice on an ephemeral port and wait for health.
 * Retries once on a fresh port: the port chosen by binding-then-closing can be taken by
 * another process before the child binds it, which would otherwise look like a hang.
 */
export async function startServer(env = {}, attempts = 3) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const { createServer } = await import("node:net");
    const port = await new Promise((resolve, reject) => {
      const s = createServer();
      s.once("error", reject);
      s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); });
    });
    const child = spawn(process.execPath, [join(process.cwd(), "docker", "server.js")], {
      env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let log = "";
    let exited = false;
    child.stdout.on("data", (d) => (log += d));
    child.stderr.on("data", (d) => (log += d));
    child.on("exit", () => (exited = true));
    const base = `http://127.0.0.1:${port}`;
    // A loaded CI runner can take several seconds to bind; wait generously.
    for (let i = 0; i < 200 && !exited; i++) {
      try { const r = await fetch(base + "/v1/health"); if (r.ok) return { base, child, log: () => log }; } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
    lastError = new Error(`REST service did not become healthy on port ${port} (attempt ${attempt + 1}):\n` + log);
    try { child.kill(); } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw lastError;
}

/** Encode interleaved float samples as a canonical 16/24-bit PCM WAV buffer. */
export function wavBuffer(samples, sampleRate, channels, bitDepth = 16) {
  const bytesPer = bitDepth / 8;
  const frames = Math.floor(samples.length / channels);
  const dataLen = frames * channels * bytesPer;
  const padded = dataLen + (dataLen & 1);
  const buf = Buffer.alloc(44 + padded);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + padded, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * channels * bytesPer, 28);
  buf.writeUInt16LE(channels * bytesPer, 32);
  buf.writeUInt16LE(bitDepth, 34);
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataLen, 40);
  let p = 44;
  const peak = bitDepth === 24 ? 8388607 : 32767;
  for (let i = 0; i < samples.length; i++) {
    const v = Math.round(Math.max(-1, Math.min(1, samples[i])) * peak);
    if (bitDepth === 24) { buf[p] = v & 255; buf[p + 1] = (v >> 8) & 255; buf[p + 2] = (v >> 16) & 255; p += 3; }
    else { buf.writeInt16LE(v, p); p += 2; }
  }
  return buf;
}
