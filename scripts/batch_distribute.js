#!/usr/bin/env node

/**
 * scripts/batch_distribute.js
 * 
 * Automated Promo Leak Batch Distribution Script
 * 
 * Generates uniquely watermarked copies of a master audio file for each recipient
 * (DJs, A&R, preview reviewers, radio stations) and produces a cryptographic
 * `recipients.json` mapping manifest to instantly pinpoint leaks.
 * 
 * Usage:
 *   node scripts/batch_distribute.js <master.wav> --recipients "DJ Snake, Zane Lowe, Annie Mac"
 *   node scripts/batch_distribute.js <master.wav> --file recipients.txt --out-dir ./promos
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { readWavFile, writeWavFile } from "../src/wav.js";
import { embedWatermark } from "../src/embed.js";

function printHelp() {
  console.log(`
Aureal Watermark — Promo Leak Batch Distribution

Usage:
  node scripts/batch_distribute.js <master.wav> [options]

Options:
  --recipients <list>   Comma-separated list of recipient names
  --file <path>         Text or JSON file containing recipient names
  --out-dir <dir>       Target output directory (default: ./dist_promos)
  --start-id <int>      Starting numerical ID (default: 100001)
  --band <band>         Carrier band: dual, high, mid (default: dual)
  --key <str>           Watermark secret key (default: built-in default)
  --strength <float>    Watermark strength 0.01 - 1.0 (default: 0.5)

Examples:
  node scripts/batch_distribute.js master.wav --recipients "DJ Snake, Annie Mac, Zane Lowe"
  node scripts/batch_distribute.js album_track1.wav --file reviewers.json --out-dir ./watermarked_promos
`);
}

function sanitizeFilename(name) {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function sha256Buffer(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    printHelp();
    process.exitCode = 0; return;
  }

  const masterPath = args[0].startsWith("--") ? null : args[0];
  if (!masterPath) {
    console.error("Error: master audio file required as first argument.");
    printHelp();
    process.exitCode = 1; return;
  }

  const flags = {};
  for (let i = 1; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    }
  }

  // Determine recipients list
  let recipientNames = [];
  if (flags.file) {
    const raw = fs.readFileSync(flags.file, "utf8").trim();
    if (raw.startsWith("[")) {
      try {
        const parsed = JSON.parse(raw);
        recipientNames = parsed.map((item) => (typeof item === "string" ? item : item.name || item.recipient));
      } catch (e) {
        console.error("Failed to parse JSON recipients file:", e.message);
        process.exitCode = 1; return;
      }
    } else {
      recipientNames = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    }
  } else if (flags.recipients) {
    recipientNames = flags.recipients.split(",").map((s) => s.trim()).filter(Boolean);
  } else {
    console.error("Error: Please provide recipients via --recipients or --file.");
    printHelp();
    process.exitCode = 1; return;
  }

  if (recipientNames.length === 0) {
    console.error("Error: No recipient names found.");
    process.exitCode = 1; return;
  }

  const outDir = path.resolve(flags["out-dir"] || "./dist_promos");
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  // Validate operator input up front: a bad flag should fail with a clear message,
  // not produce NaN payloads deep inside the embedder.
  let startId = null;
  if (flags["start-id"] !== undefined) {
    const parsed = Number(flags["start-id"]);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 0xffffffff) {
      console.error("Error: --start-id must be an integer between 0 and 4294967295.");
      process.exitCode = 1; return;
    }
    startId = parsed;
  }
  if (startId !== null && startId + recipientNames.length - 1 > 0xffffffff) {
    console.error(`Error: --start-id ${startId} with ${recipientNames.length} recipients exceeds the 32-bit ID space.`);
    process.exitCode = 1; return;
  }
  const band = flags.band === undefined ? "dual" : String(flags.band);
  if (!/^(dual|high|mid|auto|\d+\s*[:\-]\s*\d+)$/.test(band)) {
    console.error(`Error: --band must be "dual", "high", "mid", "auto", or "lowHz:highHz" (got "${band}").`);
    process.exitCode = 1; return;
  }
  const strength = flags.strength === undefined ? 0.5 : Number(flags.strength);
  if (!Number.isFinite(strength) || strength < 0.01 || strength > 1) {
    console.error("Error: --strength must be a number between 0.01 and 1.0.");
    process.exitCode = 1; return;
  }
  const key = flags.key || undefined;

  console.log(`\n======================================================`);
  console.log(`AUREAL WATERMARK — PROMO LEAK BATCH DISTRIBUTOR`);
  console.log(`======================================================`);
  console.log(`Master Audio:   ${masterPath}`);
  console.log(`Recipients:     ${recipientNames.length} recipients`);
  if (startId !== null) console.log(`ID Range:       #${startId} .. #${startId + recipientNames.length - 1}`);
  console.log(`Band / Stren:   ${band} / ${strength}`);
  console.log(`Output Folder:  ${outDir}\n`);

  console.log(`Loading master audio file...`);
  const wav = await readWavFile(masterPath);
  const format = { sampleRate: wav.sampleRate, channels: wav.channels };
  const masterBase = path.basename(masterPath, path.extname(masterPath));
  const sourceBitDepth = [16, 24, 32].includes(wav.bitsPerSample) ? wav.bitsPerSample : 16;

  const manifest = {
    schema: "aureal-recipients/1",
    masterFile: path.basename(masterPath),
    masterSampleRate: wav.sampleRate,
    masterChannels: wav.channels,
    masterBitDepth: sourceBitDepth,
    masterDurationSec: wav.durationSec,
    generatedAt: new Date().toISOString(),
    band,
    strength,
    // The watermark key is required to re-derive the spreading sequence when a leak is
    // audited. This manifest is the distributor's PRIVATE mapping file: anyone who holds
    // it can embed a matching ID, so treat it like the promos themselves.
    key: key ?? null,
    keyDefault: key ? false : true,
    startId,
    recipients: []
  };

  console.log(`Generating individually tagged audio copies:\n`);

  const usedFilenames = new Set();
  for (let i = 0; i < recipientNames.length; i++) {
    const name = recipientNames[i];
    // Random IDs unless the operator pinned a range: sequential IDs are guessable and
    // make an averaged collusion decode to a single recipient by majority vote.
    const payloadId = startId !== null
      ? startId + i
      : (crypto.randomInt(100000, 900000) * 1000 + (i + 1)) >>> 0;
    const safeName = sanitizeFilename(name) || "recipient";
    let outFilename = `${masterBase}_[${safeName}].wav`;
    let duplicate = 2;
    while (usedFilenames.has(outFilename)) {
      outFilename = `${masterBase}_[${safeName}_${duplicate++}].wav`;
    }
    usedFilenames.add(outFilename);
    const outFilePath = path.join(outDir, outFilename);

    process.stdout.write(`  [${i + 1}/${recipientNames.length}] Tagging for "${name}" (ID #${payloadId})... `);

    const watermarked = embedWatermark(wav.samples, format, {
      payloadId,
      key,
      band,
      strength
    });

    await writeWavFile(outFilePath, watermarked, {
      sampleRate: wav.sampleRate,
      channels: wav.channels,
      bitDepth: sourceBitDepth
    });

    const fileBuf = fs.readFileSync(outFilePath);
    const hash = sha256Buffer(fileBuf);

    manifest.recipients.push({
      id: payloadId,
      name,
      filename: outFilename,
      sha256: hash,
    });

    console.log(`DONE -> ${outFilename}`);
  }

  // Write mapping manifest
  const manifestPath = path.join(outDir, "recipients.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

  console.log(`\n======================================================`);
  console.log(`BATCH DISTRIBUTION COMPLETE!`);
  console.log(`======================================================`);
  console.log(`Manifest created: ${manifestPath}`);
  console.log(`\nIf a copy leaks online, identify the source with:`);
  console.log(`  node scripts/audit_leak.js leaked_audio.wav --manifest ${manifestPath}\n`);
  console.log(`NOTE: this manifest maps IDs to recipients and records the watermark key.`);
  console.log(`Keep it private — treating it as public gives away the whole distribution.`);
  console.log(`NOTE: an attacker who averages copies from several recipients can defeat`);
  console.log(`single-ID recovery; collusion resistance is not implemented.\n`);
}

main().catch((err) => {
  console.error("Batch distribution error:", err);
  process.exitCode = 1; return;
});
