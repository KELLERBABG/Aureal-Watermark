import { readWavFile, detectWatermark, packCodeword, accuseCoalition } from "../src/index.js";
import { readFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync(process.argv[3], "utf8"));
const key = process.argv[4];

if (!manifest.tardos || !manifest.recipients.some((r) => r.tardosCodeword)) {
  console.log("This manifest carries no Tardos data.");
  console.log("That is expected: collusion-resistant fingerprinting is NOT implemented in the");
  console.log("pipeline (embedWatermark only embeds packCodeword(payloadId)), so batch_distribute");
  console.log("no longer writes phantom Tardos codewords. This script remains only to reproduce");
  console.log("the original finding against an old manifest. See AUDIT_REPORT.md F3.");
  process.exit(0);
}

const wav = await readWavFile(process.argv[2]);

const res = detectWatermark(wav.samples, { sampleRate: wav.sampleRate, channels: wav.channels }, { key, band: "dual" });
console.log("detected:", res.detected, "crcOk:", res.crcOk, "conf:", res.confidence.toFixed(3));
const soft = res.details.softSymbols;
console.log("softSymbols present:", !!soft, soft ? soft.length : 0);
if (!soft) process.exit(0);

const recips = manifest.recipients
  .filter((r) => r.tardosCodeword)
  .map((r) => ({ id: r.id, name: r.name, codeword: r.tardosCodeword }));

// 1) correlation of each recipient's Tardos codeword with the embedded payload codeword
console.log("\n-- correlation between recipient Tardos codeword and its own embedded payload codeword --");
for (const r of recips) {
  const pw = packCodeword(r.id);
  let agree = 0;
  for (let j = 0; j < 48; j++) if ((r.codeword[j] > 0) === (pw[j] > 0)) agree++;
  console.log(`  ${r.name.padEnd(6)} payload=#${r.id}  agreement=${agree}/48 ${(agree === 0 || agree === 48) ? "PERFECT" : ""}`);
}

// 2) score against the recovered soft symbols
const out = accuseCoalition(soft, recips, manifest.tardos.biases);
console.log("\n-- Tardos accusation result --");
console.log("threshold:", out.threshold.toFixed(3), " median:", out.medianScore.toFixed(3), " robustStdDev:", out.robustStdDev.toFixed(3));
console.log("isCollusion:", out.isCollusion, " accused:", out.accused.map((a) => a.name).join(",") || "(none)");
console.log("ranked:");
for (const s of out.rankedScores) console.log(`  ${s.name.padEnd(6)} score=${s.score.toFixed(3)}`);

// 3) does the accuser identify the actual colluders (Alice, Bob, Carol) when we feed the ORIGINAL averaged signal
//    using the true payload-derived soft symbols? Show cross-scores for single copies too.
console.log("\n-- soft symbol summary --");
let pos = 0, neg = 0, sum = 0;
for (const v of soft) { sum += Math.abs(v); if (v > 0) pos++; else neg++; }
console.log(`  |soft| mean=${(sum / soft.length).toFixed(4)}  positive=${pos} negative=${neg}`);
