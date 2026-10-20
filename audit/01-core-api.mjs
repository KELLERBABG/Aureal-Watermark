// A1: core embed/detect matrix
import { embedWatermark, detectWatermark, synthesizeSpeechLike } from "../src/index.js";
import { whiteNoise, pinkNoise, sine, silence, broadband, stereo, snrDb } from "./lib.mjs";

const rows = [];
function rec(name, expectDetect, r, extra = "") {
  const ok = r.detected === expectDetect;
  rows.push({ name, expect: expectDetect, got: r.detected, id: r.recoveredPayloadId, conf: +r.confidence.toFixed(3), ber: +r.ber.toFixed(3), crc: r.crcOk, snr: extra, pass: ok });
  return ok;
}

const SR = 44100;
const SECS = 8;
const N = SR * SECS;
const ID = 883921;

const sources = {
  speech: { pcm: synthesizeSpeechLike({ seconds: SECS, sampleRate: SR, channels: 1, seed: "a" }), peak: 0.5 },
  broadband: { pcm: broadband(N, SR, "bb1"), peak: 0.5 },
  white: { pcm: whiteNoise(N, "w1"), peak: 0.5 },
  pink: { pcm: pinkNoise(N, "p1"), peak: 0.5 },
  sine1k: { pcm: sine(N, SR, 1000, 0.5), peak: 0.5 },
};

console.log("== embed/detect round-trip per source (mono, dual band, strength .5) ==");
for (const [name, src] of Object.entries(sources)) {
  const m = embedWatermark(src.pcm, { sampleRate: SR, channels: 1 }, { payloadId: ID });
  const snr = snrDb(src.pcm, m);
  const d = detectWatermark(m, { sampleRate: SR, channels: 1 }, { payloadId: ID });
  rec(`mono/${name}`, true, d, `SNR=${snr.toFixed(1)}dB`);
}
// expect speech to pass; white/pink noise may fail detections

console.log("\n== stereo sources ==");
for (const [name, src] of Object.entries(sources)) {
  const st = stereo(src.pcm, 2, name);
  const m = embedWatermark(st, { sampleRate: SR, channels: 2 }, { payloadId: ID });
  const d = detectWatermark(m, { sampleRate: SR, channels: 2 }, { payloadId: ID });
  rec(`stereo/${name}`, true, d, `SNR=${snrDb(st, m).toFixed(1)}`);
}

console.log("\n== sample rates (broadband mono) ==");
for (const sr of [8000, 16000, 22050, 32000, 44100, 48000, 88200, 96000, 192000]) {
  const n = sr * 6;
  const pcm = broadband(n, sr, "sr" + sr);
  try {
    const m = embedWatermark(pcm, { sampleRate: sr, channels: 1 }, { payloadId: ID });
    const d = detectWatermark(m, { sampleRate: sr, channels: 1 }, { payloadId: ID });
    rec(`sr=${sr}`, true, d, `SNR=${snrDb(pcm, m).toFixed(1)}`);
  } catch (e) {
    rows.push({ name: `sr=${sr}`, expect: true, got: `ERR:${e.message}`, pass: false });
  }
}

console.log("\n== payload id extremes ==");
for (const id of [0, 1, 255, 65535, 65536, 0x7fffffff, 0xfffffffe, 0xffffffff]) {
  const pcm = broadband(SR * 5, SR, "id" + id);
  const m = embedWatermark(pcm, { sampleRate: SR, channels: 1 }, { payloadId: id });
  const d = detectWatermark(m, { sampleRate: SR, channels: 1 }, { payloadId: id });
  rec(`id=${id}`, true, d, d.recoveredPayloadId === id ? "idExact" : "ID-MISMATCH");
  rows[rows.length - 1].idMatch = d.recoveredPayloadId === id;
}

console.log("\n== key isolation ==");
{
  const pcm = broadband(SR * 6, SR, "keytest");
  const m = embedWatermark(pcm, { sampleRate: SR, channels: 1 }, { payloadId: ID, key: "secret-A" });
  const dRight = detectWatermark(m, { sampleRate: SR, channels: 1 }, { payloadId: ID, key: "secret-A" });
  const dWrong = detectWatermark(m, { sampleRate: SR, channels: 1 }, { payloadId: ID, key: "secret-B" });
  rec("key correct", true, dRight);
  rec("key wrong (should NOT detect)", false, dWrong);
}

console.log("\n== id mismatch (should NOT detect) ==");
{
  const pcm = broadband(SR * 6, SR, "idmis");
  const m = embedWatermark(pcm, { sampleRate: SR, channels: 1 }, { payloadId: 111111 });
  const d = detectWatermark(m, { sampleRate: SR, channels: 1 }, { payloadId: 222222 });
  rec("mismatched id", false, d);
  const blind = detectWatermark(m, { sampleRate: SR, channels: 1 }, {});
  rec("blind detect", true, blind);
  rows[rows.length - 1].idMatch = blind.recoveredPayloadId === 111111;
}

console.log("\n== FALSE POSITIVE control: unwatermarked audio (should NOT detect) ==");
let fp = 0;
for (const [name, src] of Object.entries(sources)) {
  const d = detectWatermark(src.pcm, { sampleRate: SR, channels: 1 }, {});
  if (d.detected) fp++;
  rec(`clean/${name} blind`, false, d);
}
for (let t = 0; t < 20; t++) {
  const pcm = broadband(SR * 3, SR, "fp" + t);
  const d = detectWatermark(pcm, { sampleRate: SR, channels: 1 }, {});
  if (d.detected) fp++;
  if (d.detected) rec(`clean/fp${t}`, false, d);
}
console.log(`false positives: ${fp}`);

console.log("\n== strength sweep (broadband mono) ==");
for (const strength of [0.01, 0.05, 0.1, 0.25, 0.5, 0.75, 1.0]) {
  const pcm = broadband(SR * 6, SR, "str" + strength);
  const m = embedWatermark(pcm, { sampleRate: SR, channels: 1 }, { payloadId: ID, strength });
  const d = detectWatermark(m, { sampleRate: SR, channels: 1 }, { payloadId: ID });
  rec(`strength=${strength}`, true, d, `SNR=${snrDb(pcm, m).toFixed(1)}`);
}

console.log("\n== band options ==");
for (const band of ["high", "mid", "dual", { lowHz: 9000, highHz: 12000 }]) {
  const pcm = broadband(SR * 6, SR, "band" + JSON.stringify(band));
  try {
    const m = embedWatermark(pcm, { sampleRate: SR, channels: 1 }, { payloadId: ID, band });
    const d = detectWatermark(m, { sampleRate: SR, channels: 1 }, { payloadId: ID });
    rec(`band=${JSON.stringify(band)}`, true, d, `SNR=${snrDb(pcm, m).toFixed(1)}`);
  } catch (e) { rows.push({ name: `band=${JSON.stringify(band)}`, expect: true, got: "ERR:" + e.message, pass: false }); }
}

console.log("\n== channels 3..8 ==");
for (const ch of [3, 4, 6, 8]) {
  const mono = broadband(SR * 6, SR, "ch" + ch);
  const inter = stereo(mono, ch, "ch" + ch);
  try {
    const m = embedWatermark(inter, { sampleRate: SR, channels: ch }, { payloadId: ID });
    const d = detectWatermark(m, { sampleRate: SR, channels: ch }, { payloadId: ID });
    rec(`channels=${ch}`, true, d);
  } catch (e) { rows.push({ name: `channels=${ch}`, expect: true, got: "ERR:" + e.message, pass: false }); }
}

console.log("\n== duration minimum ==");
for (const secs of [0.05, 0.1, 0.2, 0.5, 0.9, 1.0, 1.5, 2.0]) {
  const pcm = broadband(Math.round(SR * secs), SR, "dur" + secs);
  try {
    const m = embedWatermark(pcm, { sampleRate: SR, channels: 1 }, { payloadId: ID });
    const d = detectWatermark(m, { sampleRate: SR, channels: 1 }, { payloadId: ID });
    rec(`dur=${secs}s`, true, d, `frame=${m.watermarkMeta.geometry.frameLen} reps=${m.watermarkMeta.geometry.reps}`);
  } catch (e) { rows.push({ name: `dur=${secs}s`, expect: true, got: "ERR:" + e.message.slice(0, 60), pass: false }); }
}

console.log("\n== silence handling ==");
{
  const pcm = silence(SR * 6);
  try {
    const m = embedWatermark(pcm, { sampleRate: SR, channels: 1 }, { payloadId: ID });
    let mx = 0;
    for (let i = 0; i < pcm.length; i++) mx = Math.max(mx, Math.abs(m[i]));
    const d = detectWatermark(m, { sampleRate: SR, channels: 1 }, { payloadId: ID });
    rec("silence embed->detect", false, d, `maxOut=${mx}`);
  } catch (e) { rows.push({ name: "silence", expect: false, got: "ERR:" + e.message, pass: false }); }
}

console.log("\n== invalid input validation ==");
const invalid = [
  ["no opts", () => embedWatermark(new Float32Array(1000), { sampleRate: SR, channels: 1 })],
  ["float id", () => embedWatermark(new Float32Array(1000), { sampleRate: SR, channels: 1 }, { payloadId: 1.5 })],
  ["negative id", () => embedWatermark(new Float32Array(1000), { sampleRate: SR, channels: 1 }, { payloadId: -1 })],
  ["huge id", () => embedWatermark(new Float32Array(1000), { sampleRate: SR, channels: 1 }, { payloadId: 2 ** 32 })],
  ["bad sr", () => embedWatermark(new Float32Array(1000), { sampleRate: 4000, channels: 1 }, { payloadId: 1 })],
  ["bad ch", () => embedWatermark(new Float32Array(1000), { sampleRate: SR, channels: 0 }, { payloadId: 1 })],
  ["nondivisible", () => embedWatermark(new Float32Array(1001), { sampleRate: SR, channels: 2 }, { payloadId: 1 })],
  ["no fmt", () => embedWatermark(new Float32Array(1000), null, { payloadId: 1 })],
  ["detect bad id", () => detectWatermark(new Float32Array(SR * 3), { sampleRate: SR, channels: 1 }, { payloadId: "x" })],
];
for (const [name, fn] of invalid) {
  try { fn(); rows.push({ name: "validate:" + name, expect: "throw", got: "no throw", pass: false }); }
  catch { rows.push({ name: "validate:" + name, expect: "throw", got: "threw", pass: true }); }
}

console.log("\n== results ==");
let fails = 0;
for (const r of rows) {
  if (!r.pass) { fails++; console.log(`FAIL ${JSON.stringify(r)}`); }
}
console.log(`\nTOTAL ${rows.length}, FAILED ${fails}`);
