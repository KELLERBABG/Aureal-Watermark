<div align="center">

![Aureal Watermark Banner](assets/banner.png)

<br>

[![Release](https://img.shields.io/badge/Release-v0.2.1-2563eb?style=flat-square)](https://github.com/KELLERBABG/Aureal-Watermark/releases/latest)
[![License](https://img.shields.io/badge/License-Dual%20(Noncommercial%20%2F%20Commercial)-059669?style=flat-square)](LICENSE.md)
[![Dependencies](https://img.shields.io/badge/Dependencies-0%20(Pure%20Stdlib)-blueviolet?style=flat-square)](package.json)
[![Platform](https://img.shields.io/badge/Platform-Universal%20(.cjs)%20%7C%20Node.js%20%7C%20Web%20Audio-111827?style=flat-square)](https://kellerbabg.github.io/Aureal-Watermark/)

<br>

[**Open Web Studio**](https://kellerbabg.github.io/Aureal-Watermark/) &bull; [**Download Universal (.cjs)**](https://github.com/KELLERBABG/Aureal-Watermark/releases/latest) &bull; [**Technical Deep Dive**](docs/TECHNICAL_SPECIFICATIONS.md) &bull; [**Code Wiki**](docs/CODEBASE_WIKI.md)

</div>

---

## What is Aureal Watermark?

**Aureal Watermark** hides an invisible digital serial number directly inside your audio files. 

Human ears cannot hear it, but our scanner can detect it in less than a second. Even if someone re-records your track, converts it to an MP3, or uploads it to social media, your hidden ownership mark stays inside the sound.

---

## Why Use It?

* **Stop Music & Voice Theft:** If someone steals your beat, song, or podcast, scan the file to prove immediately that you made the original.
* **Catch Audio Leaks:** Give each listener, producer, or preview tester a uniquely tagged copy. If the song leaks online, scan the leak to see exactly who leaked it.
* **Detect AI Training & Cloning:** Prove that your voice or music was scraped and used to train an AI model without your permission.
* **Survives MP3 Compression:** The watermark stays intact through heavy MP3 and AAC compression, volume changes, and format conversions.
* **100% Private & Offline:** Everything runs directly on your computer. Your audio files are never uploaded to any server or third party.
* **Zero Dependencies:** Pure, lightweight code with no external bloat or complicated installs.

---

## How It Works (In Plain English)

```
[ Your Audio File ] ──► [ Embed Invisible ID (#883921) ] ──► [ Protected Audio ]
                                                                     │
                                                    (Sounds 100% identical to humans)
                                                                     │
                                      Later: Someone uploads or leaks your file
                                                                     │
                                                                     ▼
                                                     [ Scan with Aureal Watermark ]
                                                                     │
                                                                     ▼
                                                   "Verified: Owned by ID #883921"
```

1. **Pick an ID number:** Choose any serial number (like `#883921` or a recipient's code).
2. **Protect the file:** Aureal embeds the number into subtle frequency layers of your audio.
3. **Audio sounds identical:** The exported file plays like normal with zero audible distortion.
4. **Scan anytime:** Drop any audio file into Aureal to extract the original owner ID and prove ownership.

---

## 3 Easy Ways to Use It

### Option 1: Web Studio (Easiest — In Your Browser)

No installation or technical setup needed:

👉 **[Launch Interactive Web Studio](https://kellerbabg.github.io/Aureal-Watermark/)**

*(Runs 100% client-side in browser memory. Nothing ever leaves your device).*

---

### Option 2: Universal Standalone Script (`aureal-watermark.cjs`)

A single, zero-dependency file that runs on **Windows, macOS, and Linux** using standard Node.js (&ge; 18):

1. Download **[`aureal-watermark.cjs`](https://github.com/KELLERBABG/Aureal-Watermark/releases/latest/download/aureal-watermark.cjs)** from the Releases page.
2. Run from your terminal or command prompt:

```bash
# 1. Embed an ID number into a song
node aureal-watermark.cjs embed master.wav protected.wav --id 883921

# 2. Check an audio file to see if it contains your ID
node aureal-watermark.cjs detect protected.wav --id 883921

# 3. Blind scan (automatically extracts any embedded ID from an unknown file)
node aureal-watermark.cjs detect mystery_audio.wav --json

# 4. Launch your local offline Web Studio
node aureal-watermark.cjs studio
```

---

### Option 3: Promo Leak Batch Distribution & Forensic Audit (For Labels & Artists)

#### 1. Generate Tagged Copies for Reviewers & DJs
Generate uniquely watermarked master copies for multiple recipients alongside a cryptographic `recipients.json` mapping manifest in a single command:

```bash
node scripts/batch_distribute.js album_master.wav --recipients "DJ Snake, Annie Mac, Zane Lowe" --out-dir ./promos
```

#### 2. One-Click Forensic Audit If a Leak Occurs
If a rip or leak appears on Discord, SoundCloud, or YouTube, pinpoint the responsible recipient in seconds:

```bash
node scripts/audit_leak.js leaked_audio.mp3 --manifest ./promos/recipients.json
```

```text
======================================================
AUREAL FORENSIC AUDIT REPORT
======================================================
Target File:      leaked_audio.mp3 (MP3 128 kbps)
Recovered ID:     #100002 (CRC-16 Valid)
Confidence:       100.0% (Eb/N0: +17.7 dB)
------------------------------------------------------
MATCH CONFIRMED IN DISTRIBUTION MANIFEST:
  Recipient Name:   Zane Lowe
  Assigned ID:      #100002
  Original File:    album_master_[Zane_Lowe].wav
======================================================
VERDICT: Leak traced directly to "Zane Lowe".
```

---

### Option 4: JavaScript / Node.js API (For Developers & Backends)

Integrate protection directly into your own apps and export pipelines:

```javascript
import { embedWatermark, detectWatermark } from "aureal-watermark";
import { readWavFile, writeWavFile } from "aureal-watermark/src/wav.js";

// Load audio file
const wav = await readWavFile("song.wav");
const format = { sampleRate: wav.sampleRate, channels: wav.channels };

// Embed watermark ID #883921
const protectedAudio = embedWatermark(wav.samples, format, { payloadId: 883921 });
await writeWavFile("song_protected.wav", protectedAudio, { ...format, bitDepth: 16 });

// Scan and verify
const result = detectWatermark(protectedAudio, format, { payloadId: 883921 });

console.log(result.detected);           // true
console.log(result.confidence);         // 0.98 (98%)
console.log(result.ebN0Db);             // +18.4 dB (Signal-to-Noise)
console.log(result.recoveredPayloadId); // 883921
```

---

## Regulatory Compliance: The EU AI Act & C2PA Bridge

### 1. EU AI Act Article 50 Machine-Readable Synthetic Audio
Under **Article 50 of the European Union AI Act**, platforms generating synthetic voices, deepfakes, or AI music must ensure outputs are marked with machine-detectable provenance.
* **The Problem:** Social media platforms (TikTok, Instagram, YouTube Shorts, WhatsApp) automatically strip ID3 tags and RIFF metadata chunks during re-encoding.
* **The Aureal Solution:** Aureal embeds the machine-readable provenance ID directly inside the acoustic wave using DSSS modulation. The watermark survives lossy re-encoding and format conversion without audible degradation.

### 2. The C2PA Content Credentials Persistence Bridge
Traditional C2PA manifests are stored in audio headers that get discarded by lossy encoders. Aureal's 32-bit payload ID serves as an indestructible **Acoustic Pointer**:
$$\text{Social Media Re-encode} \longrightarrow \text{Header Metadata Stripped} \longrightarrow \text{Aureal Acoustic Scan} \longrightarrow \text{Original C2PA Manifest Recovered}$$

---

## Operational Capabilities & Boundaries

| Transformation / Attack | Survives? | Engineering Notes |
| :--- | :---: | :--- |
| **MP3 Compression (128k / 320k)** | **YES** | Robust across 44 automated tests via `Dual` and `High` band presets. |
| **AAC / M4A Compression (128k)** | **YES** | Survives MDCT lossy psychoacoustic quantization with strong SNR margin. |
| **Volume Scaling & Normalization** | **YES** | Tolerates level shifts from $0.1\times$ to $5.0\times$ without phase disruption. |
| **Hot Master Headroom Limiting** | **YES** | Built-in true-peak limiter ($\le 0.995$) prevents clipping on $0\text{ dBFS}$ loud masters. |
| **Dynamic Silence Muting** | **YES** | Psychoacoustic masking automatically mutes carrier during quiet intros and pauses. |
| **Multi-Bit Error Correction** | **YES** | Reliability-ordered 2-bit soft-decision permutation sweep repairs flipped bits. |
| **Stereo to Mono Downmixing** | **YES** | Interleaved downmixing preserves carrier phase alignment. |
| **Linear Time Offsets / Cropping** | **YES** | Fractional resync grid ($\pm 1/16, \pm 2/16, \pm 4/16$) absorbs start-offset shifts. |
| **Additive Noise (−30 dBFS)** | **YES** | Spread-spectrum processing gain extracts signals below host noise floor. |
| **Non-Linear Time-Stretching** | **NO** | $\pm 1\text{--}2\%$ DAW warp/stretch breaks chip phase coherence *(roadmap: chirp CSS)*. |
| **Non-Linear Pitch-Shifting** | **NO** | Shifting pitch moves carriers outside the matched-filter frequency band. |

---

## Deep Dive & Technical Documentation

For audio engineers, DSP researchers, and developers who want to inspect the mathematics, frequency bands, and algorithms:

* [**Commercial Licensing & Enterprise SLA**](docs/COMMERCIAL_LICENSING.md) — Production licensing terms, pricing tiers, and compliance specifications.
* [**Technical Specifications & Benchmarks**](docs/TECHNICAL_SPECIFICATIONS.md) — DSSS carrier frequencies, BPSK modulation parameters, and measured compression tests.
* [**Codebase Wiki**](docs/CODEBASE_WIKI.md) — Complete file-by-file reference for every function and DSP module.
* [**Whitepaper**](docs/WHITEPAPER.md) — Formal threat model, detection statistics, and academic background.
* [**System Architecture**](docs/ARCHITECTURE.md) — Signal processing pipelines and audio data flow.
* [**Payload Wire Format**](docs/PAYLOAD-FORMAT.md) — 48-symbol codeword specification and CRC-16 checksums.

---

## Commercial Licensing & Enterprise SLA

Aureal Watermark is distributed under a **Dual License**:

* **Personal, Academic & Hobby Use:** Completely free and open-source under the [PolyForm Noncommercial License 1.0.0](LICENSE.md).
* **Commercial & Enterprise Use:** A commercial production license is required for commercial releases, label promo pools, SaaS audio pipelines, and AI speech platforms.

### Commercial Pricing Matrix

| Tier | Price | Includes |
| :--- | :--- | :--- |
| **Solo Creator / Indie Studio** | **$249** *(one-time)* | Unrestricted commercial rights on personal releases, Universal CLI, Web Studio. |
| **Boutique Label / A&R Desk** | **$499** *(one-time / seat)* | Batch leak distributor, one-click forensic audit script, priority leak support. |
| **B2B Audio Marketplace** | **$2,900 – $5,900 / yr** | Headless backend integration rights, commercial export hook SLA, unlimited embeds. |
| **Voice AI & Speech Platforms** | **$0.01 / min** or **$12,500 / yr** | EU AI Act Article 50 compliance, low-latency SDK integration, C2PA persistence. |
| **Audio Forensics & Legal Labs** | **$1,499** *(perpetual)* | Client-side offline forensic suite, raw $E_b/N_0$ reports, custom branding. |

For commercial licensing and enterprise SLAs, see [**docs/COMMERCIAL_LICENSING.md**](docs/COMMERCIAL_LICENSING.md) or contact **[lukas@negenborn.de](mailto:lukas@negenborn.de)**.
