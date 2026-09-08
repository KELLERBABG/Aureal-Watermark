"use strict";

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readWavFile, writeWavFile } from "../src/wav.js";
import { synthesizeSpeechLike } from "../src/synth.js";
import { embedWatermark } from "../src/embed.js";
import { detectWatermark } from "../src/detect.js";

const RATE = 48000;
const DURATION = 12; // 12 seconds
const ID = 0x5a3c91; // 5913745
const KEY = "adversarial-key-77";

const dir = mkdtempSync(join(tmpdir(), "aural-torture-"));

function ffmpeg(args) {
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], {
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function runTortureSuite() {
  console.log("=== AUREAL WATERMARK ADVERSARIAL & TORTURE TEST SUITE ===");
  console.log(`Temp Directory: ${dir}`);
  console.log(`Generating host audio (${DURATION}s @ ${RATE}Hz, stereo & mono)...`);

  // 1. Synthesize base audio
  const monoPcm = synthesizeSpeechLike({ seconds: DURATION, sampleRate: RATE, channels: 1, seed: "mono-host" });
  const stereoPcm = synthesizeSpeechLike({ seconds: DURATION, sampleRate: RATE, channels: 2, seed: "stereo-host" });

  const monoFmt = { sampleRate: RATE, channels: 1 };
  const stereoFmt = { sampleRate: RATE, channels: 2 };

  // Embed default dual-band
  const monoMarked = embedWatermark(monoPcm, monoFmt, { payloadId: ID, key: KEY, band: "dual", strength: 0.6 });
  const stereoMarked = embedWatermark(stereoPcm, stereoFmt, { payloadId: ID, key: KEY, band: "dual", strength: 0.6 });

  // Save baseline master WAVs
  const masterMonoWav = join(dir, "master_mono.wav");
  const masterStereoWav = join(dir, "master_stereo.wav");
  await writeWavFile(masterMonoWav, monoMarked, { sampleRate: RATE, channels: 1, bitDepth: 16 });
  await writeWavFile(masterStereoWav, stereoMarked, { sampleRate: RATE, channels: 2, bitDepth: 16 });

  const results = [];

  async function evaluate(testName, inputWav, expectedId = ID, key = KEY) {
    try {
      const wav = await readWavFile(inputWav);
      const res = detectWatermark(wav.samples, { sampleRate: wav.sampleRate, channels: wav.channels }, {
        key,
        payloadId: expectedId,
        band: "auto",
      });
      const passed = res.detected && res.recoveredPayloadId === expectedId;
      results.push({
        testName,
        passed,
        detected: res.detected,
        id: res.recoveredPayloadId,
        confidence: res.confidence,
        ber: res.ber,
        bandUsed: res.details?.bandUsed,
        syncMethod: res.details?.syncMethod,
      });
      const icon = passed ? "PASS" : "FAIL";
      const bandName = typeof res.details?.bandUsed === 'object' ? `${res.details.bandUsed.lowHz}-${res.details.bandUsed.highHz}Hz` : (res.details?.bandUsed || "none");
      console.log(
        `[${icon}] ${testName.padEnd(52)} | Det: ${String(res.detected).padEnd(5)} | Conf: ${res.confidence.toFixed(2)} | BER: ${res.ber.toFixed(2)} | Band: ${bandName}`
      );
      return res;
    } catch (err) {
      results.push({ testName, passed: false, error: err.message });
      console.log(`[FAIL] ${testName.padEnd(52)} | Error: ${err.message}`);
      return null;
    }
  }

  console.log("\n--- Category 1: Extreme Multi-Transcode Chains (User Scenario) ---");
  // User question: "wav to mp3, mp3 to m4a, m4a to mp4, mp4 to mp3, mp3 back to wav, compressed and sent to youtube"
  const c1_mp3 = join(dir, "chain1.mp3");
  ffmpeg(["-i", masterMonoWav, "-c:a", "libmp3lame", "-b:a", "128k", c1_mp3]);
  const c1_m4a = join(dir, "chain2.m4a");
  ffmpeg(["-i", c1_mp3, "-c:a", "aac", "-b:a", "96k", c1_m4a]);
  const c1_mp4 = join(dir, "chain3.mp4");
  ffmpeg(["-i", c1_m4a, "-f", "lavfi", "-i", "color=c=black:s=320x240:r=25", "-shortest", "-c:v", "libx264", "-c:a", "copy", c1_mp4]);
  const c1_mp3_low = join(dir, "chain4.mp3");
  ffmpeg(["-i", c1_mp4, "-c:a", "libmp3lame", "-b:a", "64k", c1_mp3_low]);
  const c1_opus = join(dir, "chain5.opus");
  ffmpeg(["-i", c1_mp3_low, "-c:a", "libopus", "-b:a", "96k", c1_opus]);
  const c1_final_wav = join(dir, "chain_final.wav");
  ffmpeg(["-i", c1_opus, "-c:a", "pcm_s16le", c1_final_wav]);
  await evaluate("WAV->MP3(128k)->AAC(96k)->MP4->MP3(64k)->Opus(96k)->WAV", c1_final_wav);

  console.log("\n--- Category 2: Brickwall Frequency Filtering ---");
  // Brickwall LPF 16kHz (wipes high band >16kHz; mid band 8k-13k should survive)
  const lpf16_wav = join(dir, "lpf_16k.wav");
  ffmpeg(["-i", masterMonoWav, "-af", "lowpass=f=16000:p=2", lpf16_wav]);
  await evaluate("Low-Pass Filter @ 16kHz (kills High Band)", lpf16_wav);

  // Brickwall LPF 12kHz (cuts top of mid band)
  const lpf12_wav = join(dir, "lpf_12k.wav");
  ffmpeg(["-i", masterMonoWav, "-af", "lowpass=f=12000:p=2", lpf12_wav]);
  await evaluate("Low-Pass Filter @ 12kHz (Mid Band partial)", lpf12_wav);

  // Brickwall LPF 7kHz (below both Mid and High bands)
  const lpf7_wav = join(dir, "lpf_7k.wav");
  ffmpeg(["-i", masterMonoWav, "-af", "lowpass=f=7000:p=2", lpf7_wav]);
  await evaluate("Low-Pass Filter @ 7kHz (Below all bands - expect strip)", lpf7_wav);

  // High-Pass Filter @ 1kHz
  const hpf1k_wav = join(dir, "hpf_1k.wav");
  ffmpeg(["-i", masterMonoWav, "-af", "highpass=f=1000", hpf1k_wav]);
  await evaluate("High-Pass Filter @ 1kHz (bass removal)", hpf1k_wav);

  // Heavy Notch filter @ 18kHz (aimed right at high-band center)
  const notch_wav = join(dir, "notch_18k.wav");
  ffmpeg(["-i", masterMonoWav, "-af", "bandreject=f=18000:width_type=q:w=2", notch_wav]);
  await evaluate("Notch Filter @ 18kHz (dual band should fallback to mid)", notch_wav);

  console.log("\n--- Category 3: Dynamics, Distortion & Air-gap/Acoustic Noise ---");
  // Brutal Overdrive: +12dB boost with hard clipping
  const clip_wav = join(dir, "clipped.wav");
  ffmpeg(["-i", masterMonoWav, "-af", "volume=12dB", clip_wav]);
  await evaluate("Brutal +12dB Overdrive with hard digital clipping", clip_wav);

  // Heavy dynamic range compression (FM radio / broadcast compressor)
  const comp_wav = join(dir, "compressed.wav");
  ffmpeg(["-i", masterMonoWav, "-af", "compand=attacks=0.01:decays=0.1:points=-80/-80|-30/-10|-10/0|0/0", comp_wav]);
  await evaluate("Aggressive Dynamic Range Compression (Broadcast)", comp_wav);

  // Air-gap acoustic simulation (Phone mic recording in room: reverb + reflections)
  const airgap_wav = join(dir, "airgap_room.wav");
  ffmpeg(["-i", masterMonoWav, "-af", "aecho=0.8:0.88:40|80:0.3|0.2", airgap_wav]);
  await evaluate("Acoustic Reverb / Room Reflection (Air-gap mic)", airgap_wav);

  // Additive background noise (-20dB pink noise)
  const noisy_wav = join(dir, "noise_pink.wav");
  ffmpeg([
    "-i", masterMonoWav,
    "-f", "lavfi", "-i", "anoisesrc=c=pink:r=48000:a=0.10",
    "-filter_complex", "[0:a][1:a]amix=inputs=2:duration=first:dropout_transition=0",
    noisy_wav,
  ]);
  await evaluate("Additive Background Noise (-20dB Pink Noise)", noisy_wav);

  console.log("\n--- Category 4: Temporal Slicing & Resampling Jitter ---");
  // Sub-second arbitrary crop (start at 373ms, duration 4.5s)
  const crop1_wav = join(dir, "crop_offset.wav");
  ffmpeg(["-ss", "0.373", "-t", "4.5", "-i", masterMonoWav, crop1_wav]);
  await evaluate("Arbitrary Time-Crop (Offset: 373ms, Len: 4.5s)", crop1_wav);

  // Short snippet crop (duration 1.8s, start at 1.12s)
  const crop2_wav = join(dir, "crop_short.wav");
  ffmpeg(["-ss", "1.12", "-t", "1.8", "-i", masterMonoWav, crop2_wav]);
  await evaluate("Short Snippet Crop (Len: 1.8s)", crop2_wav);

  // Resampling chain (48kHz -> 22050Hz -> 44100Hz -> 32000Hz -> 48000Hz)
  const resample_chain_wav = join(dir, "resample_chain.wav");
  ffmpeg(["-i", masterMonoWav, "-af", "aresample=22050,aresample=44100,aresample=32000,aresample=48000", resample_chain_wav]);
  await evaluate("Chaotic Resampling Chain (48k->22k->44k->32k->48k)", resample_chain_wav);

  // Speed drift: +0.2% (playback speed 1.002)
  const drift02_wav = join(dir, "drift_02.wav");
  ffmpeg(["-i", masterMonoWav, "-af", "asetrate=48000*1.002,aresample=48000", drift02_wav]);
  await evaluate("Speed/Pitch Drift +0.2% (Resampling drift)", drift02_wav);

  // Speed drift: +1.0% (playback speed 1.01)
  const drift10_wav = join(dir, "drift_10.wav");
  ffmpeg(["-i", masterMonoWav, "-af", "asetrate=48000*1.01,aresample=48000", drift10_wav]);
  await evaluate("Speed/Pitch Drift +1.0% (Pitch stretch)", drift10_wav);

  console.log("\n--- Category 5: Stereo & Channel Attacks ---");
  // Stereo downmix to Mono
  const mono_downmix_wav = join(dir, "stereo_downmix.wav");
  ffmpeg(["-i", masterStereoWav, "-ac", "1", mono_downmix_wav]);
  await evaluate("Stereo downmix to Mono (-ac 1)", mono_downmix_wav);

  // Mid/Side Subtraction (L - R) Vocal Remover attack
  const ms_diff_wav = join(dir, "mid_side_diff.wav");
  ffmpeg(["-i", masterStereoWav, "-af", "pan=mono|c0=c0-c1", ms_diff_wav]);
  await evaluate("Mid/Side Subtraction (L - R Vocal Remover attack)", ms_diff_wav);

  // Phase Inversion of Right channel then downmix
  const phase_inv_wav = join(dir, "phase_inv.wav");
  ffmpeg(["-i", masterStereoWav, "-af", "pan=mono|c0=0.5*c0-0.5*c1", phase_inv_wav]);
  await evaluate("Phase Inversion Cancellation (0.5*L - 0.5*R)", phase_inv_wav);

  console.log("\n--- Category 6: Watermark Collision & Tampering (Over-marking) ---");
  // Scenario A: Two different users with DIFFERENT keys mark the same audio
  const KEY_B = "competitor-malicious-key";
  const ID_B = 0x998877;
  const doubleMarked = embedWatermark(monoMarked, monoFmt, { payloadId: ID_B, key: KEY_B, band: "dual", strength: 0.6 });
  const double_wav = join(dir, "double_marked.wav");
  await writeWavFile(double_wav, doubleMarked, { sampleRate: RATE, channels: 1, bitDepth: 16 });

  console.log("-> Testing if Original Watermark A (ID_A, KEY_A) survives after Watermark B was applied on top:");
  await evaluate("Over-marking: Original Watermark A survival", double_wav, ID, KEY);
  console.log("-> Testing if Attacker Watermark B (ID_B, KEY_B) is detected:");
  await evaluate("Over-marking: Attacker Watermark B detection", double_wav, ID_B, KEY_B);

  // Scenario B: Triple Watermarking
  const KEY_C = "third-party-key";
  const ID_C = 0x112233;
  const tripleMarked = embedWatermark(doubleMarked, monoFmt, { payloadId: ID_C, key: KEY_C, band: "dual", strength: 0.6 });
  const triple_wav = join(dir, "triple_marked.wav");
  await writeWavFile(triple_wav, tripleMarked, { sampleRate: RATE, channels: 1, bitDepth: 16 });

  console.log("-> Testing Triple Watermarking (3 layers):");
  await evaluate("Triple-marking: 1st layer (Original)", triple_wav, ID, KEY);
  await evaluate("Triple-marking: 2nd layer", triple_wav, ID_B, KEY_B);
  await evaluate("Triple-marking: 3rd layer (Latest)", triple_wav, ID_C, KEY_C);

  // Scenario C: Re-marking with SAME KEY, DIFFERENT ID (Overwrite attack)
  const ID_OVERWRITE = 0x777777;
  const overwriteMarked = embedWatermark(monoMarked, monoFmt, { payloadId: ID_OVERWRITE, key: KEY, band: "dual", strength: 0.6 });
  const overwrite_wav = join(dir, "overwrite_marked.wav");
  await writeWavFile(overwrite_wav, overwriteMarked, { sampleRate: RATE, channels: 1, bitDepth: 16 });

  console.log("-> Testing Overwrite attack (Same Key, New ID):");
  await evaluate("Overwrite Attack: Can original ID be verified?", overwrite_wav, ID, KEY);
  await evaluate("Overwrite Attack: Can new ID be detected?", overwrite_wav, ID_OVERWRITE, KEY);

  console.log("\n========================================================");
  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  console.log(`SUMMARY: ${passed} / ${total} tests passed.`);
  console.log("========================================================\n");

  rmSync(dir, { recursive: true, force: true });
}

runTortureSuite().catch((err) => {
  console.error("Suite failed:", err);
  process.exit(1);
});
