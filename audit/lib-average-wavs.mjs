import { readWavFile, writeWavFile } from "../src/wav.js";

const files = process.argv.slice(2, -1);
const out = process.argv[process.argv.length - 1];
const wavs = [];
for (const f of files) wavs.push(await readWavFile(f));
const n = Math.min(...wavs.map((w) => w.samples.length));
const acc = new Float32Array(n);
for (const w of wavs) for (let i = 0; i < n; i++) acc[i] += w.samples[i];
for (let i = 0; i < n; i++) acc[i] /= wavs.length;
const channels = wavs[0].channels;
await writeWavFile(out, acc, { sampleRate: wavs[0].sampleRate, channels, bitDepth: 16 });
console.log(`averaged ${wavs.length} files -> ${out} (${(n / channels / wavs[0].sampleRate).toFixed(1)}s)`);
