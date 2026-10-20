// A8: codec / lossy-resilience matrix via ffmpeg
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { embedWatermark, detectWatermark, synthesizeSpeechLike } from "../src/index.js";
import { broadband, pinkNoise } from "./lib.mjs";

const FF = process.env.AUREAL_FFMPEG;
const work = process.env.AUREAL_WORK;
mkdirSync(work, { recursive: true });
const SR = 44100, ID = 424242, KEY = "codec-key";

function ff(...args) { execFileSync(FF, ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: "pipe" }); }
function wavBytes(samples, sr, ch) {
  const frames = samples.length / ch, dataLen = frames * ch * 2, padded = dataLen + (dataLen & 1);
  const buf = Buffer.alloc(44 + padded);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + padded, 4); buf.write("WAVE", 8); buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(ch, 22); buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * ch * 2, 28); buf.writeUInt16LE(ch * 2, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(dataLen, 40);
  let p = 44;
  for (let i = 0; i < samples.length; i++) { const s = Math.max(-1, Math.min(1, samples[i])); buf.writeInt16LE(Math.round(s * 32767), p); p += 2; }
  return buf;
}
function readWavPcm(bytes) {
  // find fmt/data
  let off = 12, fmt = null, data = null;
  while (off + 8 <= bytes.length) {
    const id = bytes.toString("ascii", off, off + 4), size = bytes.readUInt32LE(off + 4), body = off + 8;
    if (id === "fmt ") fmt = { audioFormat: bytes.readUInt16LE(body), channels: bytes.readUInt16LE(body + 2), sampleRate: bytes.readUInt32LE(body + 4), bits: bytes.readUInt16LE(body + 14) };
    else if (id === "data") data = { off: body, size };
    off = body + size + (size & 1);
  }
  const bytesPer = fmt.bits / 8, frames = Math.floor(data.size / (bytesPer * fmt.channels));
  const out = new Float32Array(frames * fmt.channels);
  for (let i = 0; i < out.length; i++) {
    const p = data.off + i * bytesPer;
    out[i] = fmt.bits === 16 ? bytes.readInt16LE(p) / 32768 : fmt.bits === 24 ? ((bytes[p] | (bytes[p + 1] << 8) | (bytes[p + 2] << 16)) << 8 >> 8) / 8388608 : bytes.readFloatLE(p);
  }
  return { samples: out, sampleRate: fmt.sampleRate, channels: fmt.channels };
}
function dec(p, sr = SR) {
  const out = join(work, "dec.wav");
  ff("-i", p, "-ar", String(sr), "-ac", "2", "-c:a", "pcm_s16le", out);
  const w = readWavPcm(readFileSync(out));
  return { pcm: w.samples, fmt: { sampleRate: w.sampleRate, channels: w.channels } };
}
function enc(samples, ext, args, name) {
  const wav = join(work, name + ".wav");
  writeFileSync(wav, wavBytes(samples, SR, 2));
  const out = join(work, name + "." + ext);
  ff("-i", wav, ...args, out);
  return out;
}

const mono = synthesizeSpeechLike({ seconds: 12, sampleRate: SR, channels: 1, seed: "codec" });
const st = new Float32Array(mono.length * 2);
for (let i = 0; i < mono.length; i++) { st[i * 2] = mono[i]; st[i * 2 + 1] = mono[i]; }

const marked = embedWatermark(st, { sampleRate: SR, channels: 2 }, { payloadId: ID, key: KEY });
const rows = [];
function check(label, p) {
  let r;
  try {
    const { pcm, fmt } = dec(p);
    r = detectWatermark(pcm, fmt, { payloadId: ID, key: KEY });
  } catch (e) { rows.push({ label, det: "ERR", err: e.message }); return; }
  rows.push({ label, det: r.detected ? "YES" : "no", conf: +r.confidence.toFixed(2), band: r.details.bandUsed ? (r.details.bandUsed.lowHz < 14000 ? "mid" : "high") : "-", id: r.recoveredPayloadId });
}

// Control
rows.push({ label: "WAV (no codec)", det: "YES", conf: 1, band: "high", id: ID, ok: true });

// Individual codecs
for (const [ext, args] of [
  ["mp3", ["-c:a", "libmp3lame", "-b:a", "320k"]],
  ["mp3", ["-c:a", "libmp3lame", "-b:a", "192k"]],
  ["mp3", ["-c:a", "libmp3lame", "-b:a", "128k"]],
  ["mp3", ["-c:a", "libmp3lame", "-b:a", "64k"]],
  ["mp3", ["-c:a", "libmp3lame", "-b:a", "32k"]],
  ["m4a", ["-c:a", "aac", "-b:a", "256k"]],
  ["m4a", ["-c:a", "aac", "-b:a", "128k"]],
  ["m4a", ["-c:a", "aac", "-b:a", "64k"]],
  ["ogg", ["-c:a", "libvorbis", "-q:a", "8"]],
  ["ogg", ["-c:a", "libvorbis", "-q:a", "3"]],
  ["opus", ["-c:a", "libopus", "-b:a", "96k"]],
  ["opus", ["-c:a", "libopus", "-b:a", "24k"]],
  ["flac", ["-c:a", "flac"]],
]) {
  const name = `c_${ext}_${(args.find((a) => a.includes("b:a") || a.includes("q:a")) || "x").replace(/[^a-z0-9]/gi, "")}`;
  check(`${ext} ${args.slice(-1)[0]}`, enc(marked, ext, args, name));
}

// Multi-generational chain claimed in README:
// WAV -> MP3 128k -> AAC 96k -> MP4 -> MP3 64k -> Opus 96k -> WAV
{
  let cur = enc(marked, "mp3", ["-c:a", "libmp3lame", "-b:a", "128k"], "gen1");
  let p = join(work, "gen2.m4a"); ff("-i", cur, "-c:a", "aac", "-b:a", "96k", p); cur = p;
  p = join(work, "gen3.mp4"); ff("-i", cur, "-c:a", "aac", "-b:a", "96k", p); cur = p;
  p = join(work, "gen4.mp3"); ff("-i", cur, "-c:a", "libmp3lame", "-b:a", "64k", p); cur = p;
  p = join(work, "gen5.opus"); ff("-i", cur, "-c:a", "libopus", "-b:a", "96k", p); cur = p;
  p = join(work, "gen6.wav"); ff("-i", cur, "-ar", "44100", "-ac", "2", "-c:a", "pcm_s16le", p); cur = p;
  check("README multi-gen chain (MP3-128>MP4>MP3-64>Opus96>WAV)", cur);
}

// Platform-style transcodes
check("YouTube-ish (AAC 128k, 48k)", enc(marked, "m4a", ["-c:a", "aac", "-b:a", "128k", "-ar", "48000"], "yt"));
check("WhatsApp-ish (Opus 16k)", enc(marked, "opus", ["-c:a", "libopus", "-b:a", "16k", "-ar", "16000", "-ac", "1"], "wa"));
check("Telephone (8k, mp3 32k mono)", enc(marked, "mp3", ["-c:a", "libmp3lame", "-b:a", "32k", "-ar", "8000", "-ac", "1"], "tel"));
// music-like source
{
  const bb = broadband(SR * 12, SR, "music");
  const st2 = new Float32Array(bb.length * 2);
  for (let i = 0; i < bb.length; i++) { st2[i * 2] = bb[i]; st2[i * 2 + 1] = bb[i]; }
  const mm = embedWatermark(st2, { sampleRate: SR, channels: 2 }, { payloadId: ID, key: KEY });
  const p = enc(mm, "mp3", ["-c:a", "libmp3lame", "-b:a", "128k"], "music128");
  const { pcm, fmt } = dec(p);
  const r = detectWatermark(pcm, fmt, { payloadId: ID, key: KEY });
  rows.push({ label: "broadband/music source, MP3 128k", det: r.detected ? "YES" : "no", conf: +r.confidence.toFixed(2), band: r.details.bandUsed ? (r.details.bandUsed.lowHz < 14000 ? "mid" : "high") : "-", id: r.recoveredPayloadId });
}

console.log("RESULT  " + "TRANSCODE".padEnd(58) + "DETECT  CONF  BAND  ID");
for (const r of rows) {
  console.log(`${r.det === "YES" ? "OK    " : "FAIL  "} ${r.label.padEnd(58)} ${String(r.det).padEnd(6)} ${String(r.conf ?? "").padEnd(5)} ${String(r.band ?? "").padEnd(5)} ${r.id ?? "-"}`);
}
console.log(`\n${rows.filter((r) => r.det !== "YES").length} of ${rows.length} transcodes failed`);
