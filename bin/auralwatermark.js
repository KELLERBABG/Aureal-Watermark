#!/usr/bin/env node
// auralwatermark — Desktop App & CLI Suite for Aureal Watermark.

import { argv, exit } from "node:process";
import { spawn, exec } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { readWavFile, writeWavFile } from "../src/wav.js";
import { synthesizeSpeechLike } from "../src/synth.js";
import { embedWatermark } from "../src/embed.js";
import { detectWatermark } from "../src/detect.js";
import { DEFAULT_BAND } from "../src/signal.js";

const HELP = `Aureal Watermark v0.2.1 — Audio watermarking for anti-theft and AI detection

Desktop App:
  auralwatermark [gui]              Launch standalone Desktop Studio application (Default)

Command Line Interface:
  auralwatermark gen out.wav --seconds 30 [--rate 44100] [--channels 1] [--bits 16]
      Generate synthetic speech-like audio for demos/tests.

  auralwatermark embed in.wav out.wav --id <uint32> [--key secret]
      [--strength 0..1] [--band high|mid|dual|lowHz:highHz]
      Embed watermark carrying the payload id (default band: dual).

  auralwatermark detect in.wav [--id <uint32>] [--key secret]
      [--band auto|high|mid|dual|lowHz:highHz] [--json]
      Verify an expected id or run blind detection + CRC decode.

Exit codes: 0 success/detected · 1 not detected · 2 error`;

function parseArgs(rest) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--help" || a === "-h") flags.help = true;
    else if (a === "--json") flags.json = true;
    else if (a.startsWith("--")) {
      const name = a.slice(2);
      const val = i + 1 < rest.length && !rest[i + 1].startsWith("--") ? rest[++i] : true;
      flags[name] = val;
    } else pos.push(a);
  }
  return { pos, flags };
}

function num(flags, name, dflt) {
  const v = flags[name];
  if (v === undefined) return dflt;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`--${name} expects a number, got '${v}'`);
  return n;
}

function bandOf(flags, dflt) {
  const b = flags.band;
  if (!b) return dflt;
  if (b === "high" || b === "mid" || b === "dual" || b === "auto") return b;
  const parts = String(b).split(":").map(Number);
  if (parts.length === 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1])) {
    return { lowHz: parts[0], highHz: parts[1] };
  }
  throw new Error(`--band must be high|mid|dual|auto or lowHz:highHz, got '${b}'`);
}

function die(msg, code = 2) {
  console.error(`error: ${msg}`);
  exit(code);
}

function getStudioHtml() {
  const candidates = [
    join(process.cwd(), "studio.html"),
    join(process.cwd(), "index.html"),
    join(process.cwd(), "demo", "index.html"),
    join(dirname(fileURLToPath(import.meta.url)), "..", "demo", "index.html"),
    join(dirname(fileURLToPath(import.meta.url)), "..", "index.html"),
  ];

  for (const c of candidates) {
    if (existsSync(c)) {
      return readFileSync(c, "utf8");
    }
  }

  return `<!doctype html><html><body><h1>Aureal Watermark Studio</h1></body></html>`;
}

function findAppRuntime() {
  if (process.platform === "win32") {
    const env = process.env;
    const candidates = [
      join(env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Microsoft\\Edge\\Application\\msedge.exe"),
      join(env["ProgramFiles"] || "C:\\Program Files", "Microsoft\\Edge\\Application\\msedge.exe"),
      join(env["LOCALAPPDATA"] || "", "Microsoft\\Edge\\Application\\msedge.exe"),
      join(env["ProgramFiles"] || "C:\\Program Files", "Google\\Chrome\\Application\\chrome.exe"),
      join(env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Google\\Chrome\\Application\\chrome.exe"),
      join(env["LOCALAPPDATA"] || "", "Google\\Chrome\\Application\\chrome.exe"),
    ];
    for (const c of candidates) {
      if (existsSync(c)) return { bin: c, type: "app" };
    }
  } else if (process.platform === "darwin") {
    const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    const edge = "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge";
    if (existsSync(chrome)) return { bin: chrome, type: "app" };
    if (existsSync(edge)) return { bin: edge, type: "app" };
  } else if (process.platform === "linux") {
    const linuxBins = ["/usr/bin/google-chrome", "/usr/bin/chromium-browser", "/usr/bin/chromium", "/usr/bin/microsoft-edge"];
    for (const b of linuxBins) {
      if (existsSync(b)) return { bin: b, type: "app" };
    }
  }
  return null;
}

function launchDesktopApp() {
  const html = getStudioHtml();
  const localFile = join(tmpdir(), "aureal-watermark-studio.html");
  writeFileSync(localFile, html, "utf8");

  // Format file:/// URL properly with forward slashes
  const fileUrl = "file:///" + localFile.split("\\").join("/");
  const runtime = findAppRuntime();

  console.log(`\n========================================================`);
  console.log(`           AUREAL WATERMARK DESKTOP STUDIO              `);
  console.log(`========================================================`);
  console.log(`Launching standalone Desktop Studio...\n`);

  if (runtime && runtime.bin) {
    const appArgs = [
      `--app=${fileUrl}`,
      `--window-size=1180,820`,
      `--app-id=aureal-watermark-studio`,
      `--no-first-run`,
    ];

    try {
      const child = spawn(runtime.bin, appArgs, {
        detached: true,
        stdio: "ignore",
      });
      child.unref();
      return;
    } catch {
      // Fallback if spawn fails
    }
  }

  // Universal browser fallback
  const opener =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
      ? "start"
      : "xdg-open";
  exec(`${opener} "${fileUrl}"`);
}

async function main() {
  const [cmd, ...rest] = argv.slice(2);

  // If launched with no arguments (e.g. double clicked in Windows Explorer) -> launch Desktop App!
  if (!cmd || cmd === "gui" || cmd === "app" || cmd === "studio") {
    launchDesktopApp();
    return;
  }

  if (cmd === "help" || cmd === "--help" || cmd === "-h") {
    console.log(HELP);
    return;
  }

  const { pos, flags } = parseArgs(rest);
  const key = flags.key;

  if (cmd === "gen") {
    const out = pos[0];
    if (!out) die("gen requires an output path: auralwatermark gen out.wav");
    const seconds = num(flags, "seconds", 10);
    const sampleRate = num(flags, "rate", 44100);
    const channels = num(flags, "channels", 1);
    const bits = num(flags, "bits", 16);
    if (![16, 24].includes(bits)) die("--bits must be 16 or 24");
    const t0 = Date.now();
    const pcm = synthesizeSpeechLike({ seconds, sampleRate, channels });
    await writeWavFile(out, pcm, { sampleRate, channels, bitDepth: bits });
    const ms = Date.now() - t0;
    console.log(
      `gen: wrote ${out} — ${seconds}s speech-like tone, ${sampleRate} Hz, ${channels}ch, ${bits}-bit PCM (${(
        ms / 1000
      ).toFixed(2)}s)`
    );
    return;
  }

  if (cmd === "embed") {
    const [inp, out] = pos;
    if (!inp || !out) die("embed requires <in.wav> <out.wav>: auralwatermark embed in.wav out.wav --id 1234567");
    if (flags.id === undefined) die("embed requires --id <uint32>");
    const payloadId = Number(flags.id);
    if (!Number.isInteger(payloadId) || payloadId < 0 || payloadId > 0xffffffff) {
      die(`--id must be a uint32 in [0, 2^32-1], got '${flags.id}'`);
    }
    const strength = num(flags, "strength", 0.5);
    const band = bandOf(flags, "dual");

    const t0 = Date.now();
    const wav = await readWavFile(inp);
    const marked = embedWatermark(wav.samples, { sampleRate: wav.sampleRate, channels: wav.channels }, {
      payloadId,
      key,
      strength,
      band,
    });
    const meta = marked.watermarkMeta;
    const bits = wav.bitsPerSample === 24 ? 24 : 16;
    await writeWavFile(out, marked, { sampleRate: wav.sampleRate, channels: wav.channels, bitDepth: bits });
    const ms = Date.now() - t0;

    const peakDb = (20 * Math.log10(meta.peakWatermark + 1e-12)).toFixed(1);
    const bandStr = Array.isArray(meta.bands)
      ? `dual (${meta.bands.map((b) => `${b.lowHz >= 14000 ? "high" : "mid"} ${b.lowHz / 1000}-${b.highHz / 1000} kHz`).join(" + ")})`
      : `${meta.band.lowHz / 1000}-${meta.band.highHz / 1000} kHz`;
    console.log(`embed: id=${payloadId} key='${meta.key}' strength=${strength} -> ${out}`);
    console.log(`  band ${bandStr}, peak watermark ${peakDb} dBFS, ${meta.geometry.reps} repetition(s), ${(ms / 1000).toFixed(2)}s`);
    return;
  }

  if (cmd === "detect") {
    const inp = pos[0];
    if (!inp) die("detect requires <in.wav>: auralwatermark detect in.wav [--id <uint32>]");
    let expectedId = undefined;
    if (flags.id !== undefined) {
      expectedId = Number(flags.id);
      if (!Number.isInteger(expectedId) || expectedId < 0 || expectedId > 0xffffffff) {
        die(`--id must be a uint32, got '${flags.id}'`);
      }
    }
    const t0 = Date.now();
    const wav = await readWavFile(inp);
    const res = detectWatermark(wav.samples, { sampleRate: wav.sampleRate, channels: wav.channels }, {
      key,
      payloadId: expectedId,
      band: bandOf(flags, "auto"),
    });
    const ms = Date.now() - t0;

    if (flags.json) {
      console.log(JSON.stringify({ file: inp, format: wav.format, durationSec: wav.durationSec, ...res }, null, 2));
    } else {
      console.log(`detect: ${inp}`);
      console.log(
        `  file:     ${wav.format}, ${wav.sampleRate} Hz, ${wav.channels}ch, ${wav.durationSec.toFixed(1)}s`
      );
      console.log(`  mode:     ${res.details.mode}${expectedId !== undefined ? ` (expect id=${expectedId})` : ""}`);
      console.log(`  detected: ${res.detected ? "YES" : "NO"}`);
      console.log(`  confidence: ${res.confidence.toFixed(3)}`);
      console.log(`  eb/n0:      ${res.ebN0Db > -30 ? `${res.ebN0Db > 0 ? "+" : ""}${res.ebN0Db} dB` : "< -30 dB"}`);
      console.log(`  sqnr:       ${res.sqnrDb > -30 ? `${res.sqnrDb > 0 ? "+" : ""}${res.sqnrDb} dB` : "< -30 dB"}`);
      console.log(
        `  band hit: ${res.details.bandUsed ? `${Math.round(res.details.bandUsed.lowHz)}-${Math.round(res.details.bandUsed.highHz)} Hz` : "-"} (${res.details.bandsTried} tried)`
      );
      console.log(`  ber:      ${(res.ber * 100).toFixed(1)}% (${Math.round(res.ber * res.details.bits)}/${res.details.bits} bits)`);
      console.log(`  recovered id: ${res.recoveredPayloadId ?? "none"}`);
      if (res.details.singleBitCorrected !== null) {
        console.log(`  note:     single-bit error corrected at position ${res.details.singleBitCorrected}`);
      }
      console.log(`  time:     ${ms} ms`);
    }
    exit(res.detected ? 0 : 1);
  }

  die(`unknown command '${cmd}'`);
}

main().catch((err) => {
  console.error("error:", err.message);
  exit(2);
});
