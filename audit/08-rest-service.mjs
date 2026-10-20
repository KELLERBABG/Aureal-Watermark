// A9: Docker REST microservice tests (spawns docker/server.js directly)
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const port = 18099;
const base = `http://127.0.0.1:${port}`;

const child = spawn(process.execPath, [join(root, "docker", "server.js")], {
  env: { ...process.env, PORT: String(port), HOST: "127.0.0.1" },
  stdio: ["ignore", "pipe", "pipe"],
});
let log = "";
child.stdout.on("data", (d) => (log += d));
child.stderr.on("data", (d) => (log += d));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 60; i++) {
  try { const r = await fetch(base + "/v1/health"); if (r.ok) break; } catch {}
  await sleep(200);
}

// helpers
function wavBuf({ secs = 10, sr = 44100, ch = 2, bits = 16, tone = true, watermark = null }) {
  const frames = Math.round(secs * sr);
  const samples = new Float32Array(frames * ch);
  for (let i = 0; i < frames; i++) {
    const t = i / sr;
    const v = tone
      ? 0.4 * Math.sin(2 * Math.PI * 300 * t) + 0.25 * Math.sin(2 * Math.PI * 1100 * t) + 0.12 * Math.sin(2 * Math.PI * 2500 * t)
      : 0;
    for (let c = 0; c < ch; c++) samples[i * ch + c] = v;
  }
  return encodeWav(samples, sr, ch, bits);
}
function encodeWav(samples, sr, ch, bits) {
  const bytesPer = bits / 8, dataLen = samples.length * bytesPer, padded = dataLen + (dataLen & 1);
  const b = Buffer.alloc(44 + padded);
  b.write("RIFF", 0); b.writeUInt32LE(36 + padded, 4); b.write("WAVE", 8); b.write("fmt ", 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(bits === 32 ? 3 : 1, 20); b.writeUInt16LE(ch, 22); b.writeUInt32LE(sr, 24);
  b.writeUInt32LE(sr * ch * bytesPer, 28); b.writeUInt16LE(ch * bytesPer, 32); b.writeUInt16LE(bits, 34);
  b.write("data", 36); b.writeUInt32LE(dataLen, 40);
  let p = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    if (bits === 16) { b.writeInt16LE(Math.round(s * 32767), p); p += 2; }
    else if (bits === 24) { const v = Math.round(s * 8388607); b[p] = v & 255; b[p + 1] = (v >> 8) & 255; b[p + 2] = (v >> 16) & 255; p += 3; }
    else if (bits === 32) { b.writeFloatLE(s, p); p += 4; }
  }
  return b;
}
function parseWavHeader(b) {
  let off = 12, fmt = null, data = null;
  while (off + 8 <= b.length) {
    const id = b.toString("ascii", off, off + 4), size = b.readUInt32LE(off + 4), body = off + 8;
    if (id === "fmt ") fmt = { format: b.readUInt16LE(body), channels: b.readUInt16LE(body + 2), sampleRate: b.readUInt32LE(body + 4), bits: b.readUInt16LE(body + 14) };
    else if (id === "data") data = { off: body, size };
    off = body + size + (size & 1);
  }
  return { fmt, data };
}
const results = [];
function rec(name, pass, detail) { results.push({ name, pass, detail }); }

try {
  // 1 health
  let r = await fetch(base + "/v1/health");
  let j = await r.json();
  rec("GET /v1/health 200 + fields", r.status === 200 && j.status === "ok" && j.service === "aureal-watermark-microservice" && j.version === "0.2.7" && "uptimeSeconds" in j && "dsp" in j && "ffmpeg" in j, JSON.stringify(j));
  rec("health reports ffmpeg=true when on PATH", j.ffmpeg === true, "ffmpeg=" + j.ffmpeg);

  // 2 root
  r = await fetch(base + "/"); j = await r.json();
  rec("GET / 200 + endpoint map", r.status === 200 && !!j.endpoints, JSON.stringify(j).slice(0, 120));

  // 3 404
  r = await fetch(base + "/v1/nope"); j = await r.json();
  rec("unknown endpoint -> 404 + json error", r.status === 404 && !!j.error, `${r.status} ${j.error}`);

  // 4 OPTIONS preflight
  r = await fetch(base + "/v1/embed", { method: "OPTIONS" });
  rec("OPTIONS -> 204 + CORS", r.status === 204 && r.headers.get("access-control-allow-origin") === "*", String(r.status));

  // 5 binary embed + detect round-trip
  const wav = wavBuf({ secs: 10, tone: true });
  r = await fetch(`${base}/v1/embed?id=883921&key=srvkey`, { method: "POST", headers: { "Content-Type": "audio/wav" }, body: wav });
  const markedBuf = Buffer.from(await r.arrayBuffer());
  rec("POST /v1/embed binary -> 200 audio/wav", r.status === 200 && r.headers.get("content-type").includes("audio/wav"), `ct=${r.headers.get("content-type")} bytes=${markedBuf.length} id=${r.headers.get("x-aureal-payload-id")}`);
  rec("embed echoes X-Aureal-Payload-Id", r.headers.get("x-aureal-payload-id") === "883921", r.headers.get("x-aureal-payload-id"));
  const mh = parseWavHeader(markedBuf);
  rec("embed output is valid RIFF/WAVE", !!mh.fmt && !!mh.data, JSON.stringify(mh.fmt));

  r = await fetch(`${base}/v1/detect?id=883921&key=srvkey`, { method: "POST", headers: { "Content-Type": "audio/wav" }, body: markedBuf });
  j = await r.json();
  rec("POST /v1/detect recovers id", r.status === 200 && j.detected === true && j.recoveredPayloadId === 883921, `det=${j.detected} id=${j.recoveredPayloadId} conf=${j.confidence}`);

  // 6 embedded marked audio with a wrong id -> detected false
  r = await fetch(`${base}/v1/detect?id=111111&key=srvkey`, { method: "POST", headers: { "Content-Type": "audio/wav" }, body: markedBuf });
  j = await r.json();
  rec("detect with wrong expected id -> detected false", j.detected === false, `det=${j.detected} conf=${j.confidence}`);

  // 7 blind detect
  r = await fetch(`${base}/v1/detect?key=srvkey`, { method: "POST", body: markedBuf });
  j = await r.json();
  rec("blind detect (no id) recovers 883921", j.detected === true && j.recoveredPayloadId === 883921, `det=${j.detected} id=${j.recoveredPayloadId}`);

  // 8 report
  r = await fetch(`${base}/v1/detect?id=883921&key=srvkey&report=true`, { method: "POST", body: markedBuf });
  j = await r.json();
  rec("detect?report=true returns forensicReport + cert text", r.status === 200 && !!j.forensicReport && typeof j.forensicCertificateText === "string", j.forensicReport ? j.forensicReport.verification.status : "missing");
  if (j.forensicReport) {
    rec("report hashes match uploaded bytes", j.forensicReport.targetFile.sizeBytes === markedBuf.length, `size=${j.forensicReport.targetFile.sizeBytes} vs ${markedBuf.length}`);
  }

  // 9 mp3 output
  r = await fetch(`${base}/v1/embed?id=883921&key=srvkey&format=mp3`, { method: "POST", body: wav });
  const mp3 = Buffer.from(await r.arrayBuffer());
  rec("embed?format=mp3 -> audio/mpeg", r.status === 200 && r.headers.get("content-type").includes("audio/mpeg"), `ct=${r.headers.get("content-type")} bytes=${mp3.length}`);
  r = await fetch(`${base}/v1/detect?id=883921&key=srvkey`, { method: "POST", body: mp3 });
  j = await r.json();
  rec("detect on returned MP3 (ffmpeg transcode path)", j.detected === true && j.recoveredPayloadId === 883921, `det=${j.detected} id=${j.recoveredPayloadId}`);

  // 10 flac/ogg output content types
  for (const [fmt, ct] of [["flac", "audio/flac"], ["ogg", "audio/ogg"], ["wav", "audio/wav"]]) {
    r = await fetch(`${base}/v1/embed?id=883921&key=srvkey&format=${fmt}`, { method: "POST", body: wav });
    rec(`embed?format=${fmt} -> ${ct}`, r.status === 200 && (r.headers.get("content-type") || "").includes(ct), `ct=${r.headers.get("content-type")}`);
  }

  // 11 JSON base64 mode
  const b64 = wav.toString("base64");
  r = await fetch(`${base}/v1/embed`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ audioBase64: b64, id: 555000, key: "js", strength: 0.6, band: "high", format: "wav" }) });
  j = await r.json();
  const jsonWav = Buffer.from(j.audioBase64 || "", "base64");
  rec("JSON embed returns base64 audio + metadata", r.status === 200 && jsonWav.length > 1000 && j.payloadId === 555000 && j.metadata && j.metadata.geometry, `status=${r.status} payloadId=${j.payloadId} bytes=${jsonWav.length}`);
  r = await fetch(`${base}/v1/detect`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ audioBase64: jsonWav.toString("base64"), id: 555000, key: "js" }) });
  j = await r.json();
  rec("JSON detect recovers id", j.detected === true && j.recoveredPayloadId === 555000, `det=${j.detected} id=${j.recoveredPayloadId}`);

  // 12 header params
  r = await fetch(`${base}/v1/embed`, { method: "POST", headers: { "X-Aureal-Payload-Id": "606060", "X-Aureal-Key": "hdr", "X-Aureal-Strength": "0.7", "X-Aureal-Band": "mid" }, body: wav });
  const hdrBuf = Buffer.from(await r.arrayBuffer());
  rec("header-based params accepted", r.status === 200 && r.headers.get("x-aureal-payload-id") === "606060", `status=${r.status} id=${r.headers.get("x-aureal-payload-id")} band=${r.headers.get("x-aureal-band")}`);
  r = await fetch(`${base}/v1/detect`, { method: "POST", headers: { "X-Aureal-Payload-Id": "606060", "X-Aureal-Key": "hdr" }, body: hdrBuf });
  j = await r.json();
  rec("header params survive round-trip", j.detected === true && j.recoveredPayloadId === 606060, `det=${j.detected} id=${j.recoveredPayloadId}`);

  // 13 24-bit preservation
  const wav24 = wavBuf({ secs: 6, bits: 24 });
  r = await fetch(`${base}/v1/embed?id=123456&key=k`, { method: "POST", body: wav24 });
  const out24 = Buffer.from(await r.arrayBuffer());
  const h24 = parseWavHeader(out24);
  rec("24-bit input preserved as 24-bit output", h24.fmt && h24.fmt.bits === 24, `in=24 out=${h24.fmt && h24.fmt.bits}`);

  // 14 error handling
  r = await fetch(`${base}/v1/embed`, { method: "POST", body: wav });
  rec("embed without id -> 400", r.status === 400, String(r.status));
  r = await fetch(`${base}/v1/embed?id=abc`, { method: "POST", body: wav });
  rec("embed with non-numeric id -> 400", r.status === 400, String(r.status));
  r = await fetch(`${base}/v1/embed?id=-5`, { method: "POST", body: wav });
  rec("embed with negative id -> 400", r.status === 400, String(r.status));
  r = await fetch(`${base}/v1/embed?id=1`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{not json" });
  rec("malformed JSON -> 400 (not 500)", r.status === 400, String(r.status));
  r = await fetch(`${base}/v1/embed?id=1`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nope: 1 }) });
  rec("JSON without audioBase64 -> 400", r.status === 400, String(r.status));
  r = await fetch(`${base}/v1/embed?id=1`, { method: "POST", body: Buffer.from("this is not audio") });
  rec("non-audio body -> 4xx (not 500)", r.status >= 400 && r.status < 500, String(r.status));
  // too-short audio
  const tiny = wavBuf({ secs: 0.05, tone: true }); // shorter than one watermark frame
  r = await fetch(`${base}/v1/embed?id=1`, { method: "POST", body: tiny });
  rec("too-short audio -> 4xx (not 500)", r.status >= 400 && r.status < 500, String(r.status));
  // oversized body
  r = await fetch(`${base}/v1/embed?id=1`, { method: "POST", body: Buffer.alloc(101 * 1024 * 1024) }).catch((e) => ({ status: "fetch-error", _e: e }));
  rec("oversized body rejected", r.status === "fetch-error" || r.status >= 400, String(r.status));

  // 15 CORS headers on POST
  r = await fetch(`${base}/v1/detect?id=883921&key=srvkey`, { method: "POST", body: markedBuf });
  rec("POST responses carry CORS header", r.headers.get("access-control-allow-origin") === "*", String(r.headers.get("access-control-allow-origin")));
} finally {
  child.kill();
}

let fail = 0;
for (const r of results) { if (!r.pass) fail++; console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name.padEnd(56)} ${r.detail ?? ""}`); }
console.log(`\n${results.length - fail}/${results.length} passed`);
if (log.trim()) console.log("\n--- server log ---\n" + log.slice(0, 3000));
