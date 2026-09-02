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

### Option 3: JavaScript / Node.js API (For Developers & Backends)

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
console.log(result.recoveredPayloadId); // 883921
```

---

## Deep Dive & Technical Documentation

For audio engineers, DSP researchers, and developers who want to inspect the mathematics, frequency bands, and algorithms:

* [**Technical Specifications & Benchmarks**](docs/TECHNICAL_SPECIFICATIONS.md) — DSSS carrier frequencies, BPSK modulation parameters, and measured compression tests.
* [**Codebase Wiki**](docs/CODEBASE_WIKI.md) — Complete file-by-file reference for every function and DSP module.
* [**Whitepaper**](docs/WHITEPAPER.md) — Formal threat model, detection statistics, and academic background.
* [**System Architecture**](docs/ARCHITECTURE.md) — Signal processing pipelines and audio data flow.
* [**Payload Wire Format**](docs/PAYLOAD-FORMAT.md) — 48-symbol codeword specification and CRC-16 checksums.

---

## License & Commercial Use

Aureal Watermark is available under a **Dual License**:

* **Personal, Academic & Hobby Use:** Completely free and open-source under the [PolyForm Noncommercial License 1.0.0](LICENSE.md).
* **Commercial & Business Use:** A commercial license is required for businesses, commercial software integrations, record labels, and revenue-generating platforms.

To purchase a commercial license or discuss custom integration, please open an inquiry on the [GitHub Issues](https://github.com/KELLERBABG/Aureal-Watermark/issues) page or contact [@KELLERBABG](https://github.com/KELLERBABG).
