// A11: WAV I/O edge cases + CLI/API validation + custom band handling
import { parseWav, writeWav, embedWatermark, detectWatermark, crc16, packCodeword, unpackCodeword, isValidPayloadId } from "../src/index.js";
import { synthesizeSpeechLike } from "../src/index.js";
import { readFileSync, writeFileSync } from "node:fs";

const rows = [];
const ok = (name, cond, detail = "") => rows.push({ name, pass: !!cond, detail });

// --- CRC known vector
ok("crc16('123456789') === 0x29B1 (CRC-16/CCITT-FALSE)", crc16([...Buffer.from("123456789")]) === 0x29b1, "0x" + crc16([...Buffer.from("123456789")]).toString(16));

// --- pack/unpack round-trip for boundary ids
let rt = true;
for (const id of [0, 1, 2 ** 31, 2 ** 32 - 1, 123456789]) {
  const cw = packCodeword(id);
  const u = unpackCodeword(cw);
  if (u.id !== id || !u.crcOk) rt = false;
}
ok("packCodeword/unpackCodeword round-trip incl. 0 and 0xFFFFFFFF", rt);

// --- writeWav/parseWav for each bit depth
const SR = 22050;
const mono = synthesizeSpeechLike({ seconds: 2, sampleRate: SR, channels: 1 });
for (const bits of [16, 24, 32]) {
  const buf = writeWav(mono, { sampleRate: SR, channels: 1, bitDepth: bits });
  const parsed = parseWav(buf);
  let maxErr = 0;
  for (let i = 0; i < mono.length; i++) maxErr = Math.max(maxErr, Math.abs(mono[i] - parsed.samples[i]));
  ok(`writeWav ${bits}-bit -> parseWav round-trip`, parsed.bitsPerSample === bits && parsed.sampleRate === SR && maxErr < (bits === 16 ? 1e-4 : bits === 24 ? 1e-6 : 1e-7), `maxErr=${maxErr.toExponential(2)}`);
}

// --- 8-bit input parse
{
  const frames = 1000;
  const b = Buffer.alloc(44 + frames);
  b.write("RIFF", 0); b.writeUInt32LE(36 + frames, 4); b.write("WAVE", 8); b.write("fmt ", 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24);
  b.writeUInt32LE(8000, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write("data", 36); b.writeUInt32LE(frames, 40);
  for (let i = 0; i < frames; i++) b[44 + i] = i & 255;
  const p = parseWav(b);
  ok("parseWav 8-bit PCM", p.bitsPerSample === 8 && p.samples.length === frames && Math.abs(p.samples[0] + 1) < 1e-9 && Math.abs(p.samples[255] - (255 - 128) / 128) < 1e-9);
}

// --- WAVE_FORMAT_EXTENSIBLE 32-bit float
{
  const frames = 500;
  const dataLen = frames * 4;
  const b = Buffer.alloc(44 + 24 + dataLen);
  b.write("RIFF", 0); b.writeUInt32LE(36 + 24 + dataLen, 4); b.write("WAVE", 8);
  b.write("fmt ", 12); b.writeUInt32LE(40, 16); b.writeUInt16LE(0xfffe, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(44100, 24); b.writeUInt32LE(44100 * 4, 28); b.writeUInt16LE(4, 32); b.writeUInt16LE(32, 34);
  b.writeUInt16LE(22, 36); b.writeUInt16LE(32, 38); b.writeUInt16LE(4, 40);
  b.writeUInt16LE(3, 44); // SubFormat = IEEE float
  b.write("data", 60); b.writeUInt32LE(dataLen, 64);
  for (let i = 0; i < frames; i++) b.writeFloatLE(0.5, 68 + i * 4);
  const p = parseWav(b);
  ok("parseWav WAVE_FORMAT_EXTENSIBLE float32", p.format === "IEEE float 32-bit" && Math.abs(p.samples[10] - 0.5) < 1e-9, p.format);
}

// --- malformed / unsupported WAVs must throw WavError, not crash
const bad = [
  ["empty", Buffer.alloc(0)],
  ["garbage", Buffer.from("hello world this is not audio")],
  ["RIFF but not WAVE", Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("XXXX"), Buffer.alloc(40)])],
  ["truncated chunk", (() => { const b = Buffer.alloc(60); b.write("RIFF", 0); b.writeUInt32LE(52, 4); b.write("WAVE", 8); b.write("fmt ", 12); b.writeUInt32LE(9999, 16); return b; })()],
];
for (const [name, buf] of bad) {
  let threw = false, msg = "";
  try { parseWav(buf); } catch (e) { threw = true; msg = e.message; }
  ok(`parseWav rejects ${name}`, threw, msg.slice(0, 70));
}

// --- ADTS/MP3 header must not be silently accepted
{
  const mp3 = readFileSync(process.env.AUREAL_MP3 || "");
  let threw = false;
  try { parseWav(mp3); } catch (e) { threw = true; }
  ok("parseWav rejects an MP3 file", threw);
}

// --- custom band object is honoured?
{
  const pcm = synthesizeSpeechLike({ seconds: 6, sampleRate: 44100, channels: 1 });
  const st = new Float32Array(pcm.length * 2);
  for (let i = 0; i < pcm.length; i++) { st[i * 2] = pcm[i]; st[i * 2 + 1] = pcm[i]; }
  const m = embedWatermark(st, { sampleRate: 44100, channels: 2 }, { payloadId: 4242, band: { lowHz: 12000, highHz: 14000 } });
  const meta = m.watermarkMeta;
  ok("custom band {12000,14000} is used by embedWatermark", !!meta.bands && meta.bands.length === 1 && meta.bands[0].lowHz === 12000, JSON.stringify(meta.bands));
}

// --- detect options resample/drift honoured
{
  const pcm = synthesizeSpeechLike({ seconds: 6, sampleRate: 44100, channels: 1 });
  const st = new Float32Array(pcm.length * 2);
  for (let i = 0; i < pcm.length; i++) { st[i * 2] = pcm[i]; st[i * 2 + 1] = pcm[i]; }
  const m = embedWatermark(st, { sampleRate: 44100, channels: 2 }, { payloadId: 4242 });
  const r = detectWatermark(m, { sampleRate: 44100, channels: 2 }, { payloadId: 4242, resample: false, drift: false });
  ok("detect with resample:false, drift:false still detects", r.detected);
}

// --- low sample rates must produce a usable, non-degenerate band under Nyquist
for (const sr of [8000, 11025, 16000]) {
  const pcm = synthesizeSpeechLike({ seconds: 8, sampleRate: sr, channels: 1 });
  const st = new Float32Array(pcm.length * 2);
  for (let i = 0; i < pcm.length; i++) { st[i * 2] = pcm[i]; st[i * 2 + 1] = pcm[i]; }
  const m = embedWatermark(st, { sampleRate: sr, channels: 2 }, { payloadId: 4242 });
  const bands = m.watermarkMeta.bands;
  const degenerate = bands.some((b) => b.highHz - b.lowHz < 200)
    || new Set(bands.map((b) => `${b.lowHz}-${b.highHz}`)).size !== bands.length
    || bands.some((b) => b.highHz > sr / 2);
  const r = detectWatermark(m, { sampleRate: sr, channels: 2 }, { payloadId: 4242 });
  ok(`sr=${sr}: bands are distinct, non-degenerate and under Nyquist`, !degenerate, JSON.stringify(bands));
  ok(`sr=${sr}: embed->detect works`, r.detected, `conf=${r.confidence.toFixed(2)}`);
}

// --- an impossible custom band is rejected instead of silently collapsing
{
  let threw = false, msg = "";
  try { embedWatermark(new Float32Array(44100 * 2 * 3), { sampleRate: 8000, channels: 2 }, { payloadId: 1, band: { lowHz: 12000, highHz: 13000 } }); }
  catch (e) { threw = true; msg = e.message; }
  ok("custom band above Nyquist is rejected with a clear error", threw, msg.slice(0, 90));
}

let fail = 0;
for (const r of rows) { if (!r.pass) fail++; console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.detail ? "  [" + r.detail + "]" : ""}`); }
console.log(`\n${rows.length - fail}/${rows.length} passed`);
