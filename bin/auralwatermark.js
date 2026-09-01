#!/usr/bin/env node
// auralwatermark CLI — gen / embed / detect / interactive studio.

import { argv, exit } from "node:process";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { exec } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { readWavFile, writeWavFile } from "../src/wav.js";
import { synthesizeSpeechLike } from "../src/synth.js";
import { embedWatermark } from "../src/embed.js";
import { detectWatermark } from "../src/detect.js";
import { DEFAULT_BAND } from "../src/signal.js";

const HELP = `auralwatermark v0.2.0 — inaudible provenance watermark for human-made audio

Usage:
  auralwatermark gen out.wav --seconds 30 [--rate 44100] [--channels 1] [--bits 16]
      Generate synthetic speech-like audio for demos/tests.

  auralwatermark embed in.wav out.wav --id <uint32> [--key secret]
      [--strength 0..1] [--band high|mid|dual|lowHz:highHz]
      Embed watermark carrying the payload id (default band: dual — the
      payload goes into BOTH 16.5-19.5 kHz and 8-13 kHz for codec survival).

  auralwatermark detect in.wav [--id <uint32>] [--key secret]
      [--band auto|high|mid|dual|lowHz:highHz] [--json]
      Verify an expected id (matched filter) or run blind detection + CRC
      decode when --id is omitted. Default --band auto tries high+mid and
      keeps the best-scoring result.

  auralwatermark studio [--port 3000]
      Launch local web studio in your default browser.

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

function openBrowser(url) {
  const start =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
      ? "start"
      : "xdg-open";
  exec(`${start} ${url}`);
}

function startStudioServer(port = 3000) {
  // Locate html template
  let html = null;
  const candidates = [
    join(process.cwd(), "studio.html"),
    join(process.cwd(), "index.html"),
    join(process.cwd(), "demo", "index.html"),
    join(dirname(fileURLToPath(import.meta.url)), "..", "demo", "index.html"),
    join(dirname(fileURLToPath(import.meta.url)), "..", "index.html"),
  ];

  for (const c of candidates) {
    if (existsSync(c)) {
      html = readFileSync(c, "utf8");
      break;
    }
  }

  if (!html) {
    html = `<!doctype html><html><body><h1>Aureal Watermark Studio</h1><p>Please open demo/index.html or download the latest release bundle.</p></body></html>`;
  }

  const server = createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  });

  server.listen(port, () => {
    const url = `http://localhost:${port}`;
    console.log(`\nAureal Watermark Studio is running at: ${url}`);
    console.log(`Opening default web browser...\n`);
    openBrowser(url);
    console.log(`Press Ctrl+C to stop the studio server.\n`);
  });
}

async function interactiveMenu() {
  const rl = createInterface({ input: stdin, output: stdout });

  while (true) {
    console.clear();
    console.log(`==============================================================`);
    console.log(`                  AUREAL WATERMARK STUDIO                     `);
    console.log(`   Inaudible Audio Provenance & Forensic Attribution CLI      `);
    console.log(`==============================================================`);
    console.log(` [1] Launch Web Studio in Browser (Recommended)`);
    console.log(` [2] Embed Watermark into Audio File (.wav)`);
    console.log(` [3] Scan / Verify Audio File (.wav)`);
    console.log(` [4] Generate Speech-like Test Audio (.wav)`);
    console.log(` [5] View Command-Line Help`);
    console.log(` [6] Exit`);
    console.log(`==============================================================`);

    const choice = (await rl.question(`Select an option [1-6]: `)).trim();

    if (choice === "1") {
      startStudioServer(3000);
      await rl.question(`\nServer is active. Press Enter to return to menu...`);
    } else if (choice === "2") {
      console.log(`\n--- EMBED WATERMARK ---`);
      const inPath = (await rl.question(`Input WAV path: `)).trim().replace(/^['"]|['"]$/g, "");
      if (!inPath || !existsSync(inPath)) {
        console.log(`File not found: ${inPath}`);
        await rl.question(`Press Enter to continue...`);
        continue;
      }
      let idStr = (await rl.question(`Tracking ID (uint32, or press Enter for random): `)).trim();
      let payloadId = idStr === "" ? Math.floor(100000 + Math.random() * 900000) : Number(idStr);
      const outPath = (await rl.question(`Output WAV path [default: marked.wav]: `)).trim() || "marked.wav";
      
      try {
        console.log(`Embedding ID #${payloadId}...`);
        const wav = await readWavFile(inPath);
        const marked = embedWatermark(wav.samples, { sampleRate: wav.sampleRate, channels: wav.channels }, {
          payloadId,
          strength: 0.5,
          band: "dual",
        });
        await writeWavFile(outPath, marked, { sampleRate: wav.sampleRate, channels: wav.channels, bitDepth: 16 });
        console.log(`\nSUCCESS! Watermarked master saved to: ${outPath} (ID #${payloadId})`);
      } catch (err) {
        console.log(`\nFailed: ${err.message}`);
      }
      await rl.question(`\nPress Enter to continue...`);
    } else if (choice === "3") {
      console.log(`\n--- VERIFY AUDIO ---`);
      const inPath = (await rl.question(`Audio WAV path: `)).trim().replace(/^['"]|['"]$/g, "");
      if (!inPath || !existsSync(inPath)) {
        console.log(`File not found: ${inPath}`);
        await rl.question(`Press Enter to continue...`);
        continue;
      }
      const idStr = (await rl.question(`Expected ID (or press Enter for blind auto-detection): `)).trim();
      const expectedId = idStr !== "" ? Number(idStr) : undefined;
      
      try {
        console.log(`Analyzing audio waveform...`);
        const wav = await readWavFile(inPath);
        const res = detectWatermark(wav.samples, { sampleRate: wav.sampleRate, channels: wav.channels }, {
          payloadId: expectedId,
          band: "auto",
        });
        console.log(`\n--- VERIFICATION RESULT ---`);
        console.log(`Verdict:        ${res.detected ? "VERIFIED / WATERMARK FOUND" : "NOT DETECTED"}`);
        console.log(`Confidence:     ${(res.confidence * 100).toFixed(1)}%`);
        console.log(`Payload ID:     ${res.recoveredPayloadId ? `#${res.recoveredPayloadId}` : "None"}`);
        console.log(`Bit Error Rate: ${(res.ber * 100).toFixed(1)}%`);
        console.log(`Carrier Band:   ${res.details.bandUsed ? `${Math.round(res.details.bandUsed.lowHz)}-${Math.round(res.details.bandUsed.highHz)} Hz` : "None"}`);
      } catch (err) {
        console.log(`\nScan failed: ${err.message}`);
      }
      await rl.question(`\nPress Enter to continue...`);
    } else if (choice === "4") {
      const outPath = (await rl.question(`Output test WAV [default: test.wav]: `)).trim() || "test.wav";
      const pcm = synthesizeSpeechLike({ seconds: 15, sampleRate: 44100, channels: 1 });
      await writeWavFile(outPath, pcm, { sampleRate: 44100, channels: 1, bitDepth: 16 });
      console.log(`Generated 15s test audio: ${outPath}`);
      await rl.question(`\nPress Enter to continue...`);
    } else if (choice === "5") {
      console.log(`\n${HELP}\n`);
      await rl.question(`Press Enter to continue...`);
    } else if (choice === "6") {
      console.log(`Goodbye!`);
      rl.close();
      break;
    }
  }
}

async function main() {
  const [cmd, ...rest] = argv.slice(2);

  // If double-clicked without arguments or run interactively
  if (!cmd) {
    if (process.stdin.isTTY) {
      await interactiveMenu();
      return;
    } else {
      console.log(HELP);
      return;
    }
  }

  if (cmd === "help" || cmd === "--help" || cmd === "-h") {
    console.log(HELP);
    return;
  }

  if (cmd === "studio") {
    const { flags } = parseArgs(rest);
    const port = num(flags, "port", 3000);
    startStudioServer(port);
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
