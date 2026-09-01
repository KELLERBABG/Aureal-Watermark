<div align="center">

# AUREAL WATERMARK

**Inaudible Spread-Spectrum Acoustic Watermarking for Audio Provenance, Leak Tracking & AI Voice Protection**

[![Release](https://img.shields.io/github/v/release/KELLERBABG/Aureal-Watermark?color=2563eb&label=Release&style=flat-square)](https://github.com/KELLERBABG/Aureal-Watermark/releases/latest)
[![License](https://img.shields.io/badge/License-Dual%20(Noncommercial%20%2F%20Commercial)-059669?style=flat-square)](LICENSE.md)
[![Dependencies](https://img.shields.io/badge/Dependencies-0%20(Pure%20Stdlib)-blueviolet?style=flat-square)](package.json)
[![Platform](https://img.shields.io/badge/Platform-CLI%20%7C%20Node.js%20%7C%20Web%20Audio-111827?style=flat-square)](https://kellerbabg.github.io/Aureal-Watermark/)
[![Tests](https://img.shields.io/badge/Tests-42%20Passing%20(incl.%20ffmpeg%20codecs)-success?style=flat-square)](test/)

<br>

[**Interactive Web Studio**](https://kellerbabg.github.io/Aureal-Watermark/) &bull; [**Download Standalone (.exe)**](https://github.com/KELLERBABG/Aureal-Watermark/releases/latest) &bull; [**Codebase Wiki**](docs/CODEBASE_WIKI.md) &bull; [**Whitepaper**](docs/WHITEPAPER.md)

</div>

<br>

```
Frequency (Hz)
20 kHz ─────────────────────────────────────────────────────────────
        ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  <-- Dual-Band DSSS Carrier
16 kHz ─────────────────────────────────────────────────────────────      (48-symbol BPSK, Hann burst shaped)
        [ Musical Harmonics, Vocals, Percussion, Speech Formants ]        (Inaudible / Diffuse noise profile)
 8 kHz ─────────────────────────────────────────────────────────────
```

---

## Overview

**Aureal Watermark** embeds cryptographic 32-bit tracking payloads directly into audio waveforms with zero perceptible degradation. It acts as an active digital serial number designed to survive lossy compression (MP3, AAC, OGG), multi-generation transcoding, gain variations, and background acoustic noise.

* **Zero External Dependencies:** Built with pure ESM JavaScript using only standard Node.js & browser Web Audio APIs (`0` npm packages).
* **Multi-Platform Architecture:** Fast CLI for server automation, clean ESM library for Node.js developers, and a standalone single-page Studio that runs 100% client-side in the browser.
* **Battle-Tested Resilience:** Verified against real multi-generation MP3 (128k/320k) and AAC (128k) re-encoding round-trips via `ffmpeg`.

---

## Core Capabilities

| Feature | Specification |
| :--- | :--- |
| **Modulation** | Direct-Sequence Spread Spectrum (DSSS) with 48-symbol BPSK codewords |
| **Payload Capacity** | 32-bit payload ID + 16-bit CRC-16/CCITT error correction ($4,294,967,296$ unique IDs) |
| **Carrier Bands** | `High` (16.5–19.5 kHz), `Mid` (8–13 kHz), and `Dual` (Redundant multi-band) |
| **Psychoacoustic Level** | Embedded at $-24\text{ dB}$ to $-30\text{ dBFS}$ with continuous Hann-window burst shaping |
| **Format Support** | PCM WAV (8/16/24/32-bit int, 32-bit float), MP3, AAC/M4A, OGG, FLAC |
| **Detection Engine** | Coherent frame stacking, matched-filter amplitude $z$-scoring, and sample resync search |

---

## Measured Codec Robustness

Tested across 42 automated tests including real `ffmpeg` encoding/decoding cycles on synthetic and real voice material:

| Carrier Band | MP3 128 kbps | MP3 320 kbps | AAC 128 kbps | Additive Noise (−30 dBFS) | Gain Shift (0.5× / 2.0×) |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Dual Band** | ✔ Pass | ✔ Pass | ✔ Pass | ✔ Pass | ✔ Pass |
| **Mid Band** | ✔ Pass | ✔ Pass | ✔ Pass | ✔ Pass | ✔ Pass |
| **High Band** | ✔ Pass | ✔ Pass | ✔ Pass | ✔ Pass | ✔ Pass |

---

## Quick Start

### 1. Standalone Executable (No Node.js Required)

Download the pre-compiled binary from the [Releases Page](https://github.com/KELLERBABG/Aureal-Watermark/releases/latest):

```powershell
# 1. Embed tracking ID into an audio file
.\aureal-watermark.exe embed master.wav tagged.wav --id 883921

# 2. Detect and verify the watermark
.\aureal-watermark.exe detect tagged.wav --id 883921
```

---

### 2. CLI Usage (via Node.js)

```bash
# Clone the repository
git clone https://github.com/KELLERBABG/Aureal-Watermark.git
cd Aureal-Watermark

# Run full test suite (42 tests)
node --test

# 1. Embed a 32-bit tracking ID into an audio file
node bin/auralwatermark.js embed input.wav output.wav --id 883921

# 2. Verify an expected ID (Verify Mode -> Exits 0 on match, 1 on fail)
node bin/auralwatermark.js detect output.wav --id 883921

# 3. Blind Detection (Auto-extracts any embedded ID without prior knowledge)
node bin/auralwatermark.js detect unknown_audio.wav --json
```

---

### 3. Node.js / ESM API

```javascript
import { embedWatermark, detectWatermark } from "aureal-watermark";
import { readWavFile, writeWavFile } from "aureal-watermark/src/wav.js";

// Read source WAV file
const wav = await readWavFile("master.wav");
const fmt = { sampleRate: wav.sampleRate, channels: wav.channels };

// Embed Watermark
const watermarked = embedWatermark(wav.samples, fmt, {
  payloadId: 883921,
  key: "studio-secret-salt",
  strength: 0.5,
  band: "dual"
});
await writeWavFile("tagged_master.wav", watermarked, { ...fmt, bitDepth: 16 });

// Detect / Verify Watermark
const result = detectWatermark(watermarked, fmt, {
  payloadId: 883921,
  key: "studio-secret-salt"
});

console.log(result.detected);           // true
console.log(result.confidence);         // 0.98 (98%)
console.log(result.recoveredPayloadId); // 883921
console.log(result.ber);                // 0.0 (0% bit error rate)
```

---

### 4. Browser Web Studio

Aureal Watermark runs completely client-side in modern browsers using native Web Audio decoding:

```html
<script type="module">
  import { verifyAudioBuffer, verifyWav } from "./src/browser/aural-watermark-verify.js";

  // Decode any audio file (MP3, WAV, AAC, M4A, OGG) via Web Audio
  const ctx = new AudioContext();
  const audioBuffer = await ctx.decodeAudioData(fileArrayBuffer);

  // Scan in browser
  const result = verifyAudioBuffer(audioBuffer, 883921);
  if (result.detected) {
    console.log(`Verified provenance ID: #${result.recoveredPayloadId} (${result.confidence * 100}% confidence)`);
  }
</script>
```

---

## Technical Documentation

* [docs/CODEBASE_WIKI.md](docs/CODEBASE_WIKI.md) — Comprehensive guide to all source files, functions, DSP mathematics, and pipelines.
* [docs/WHITEPAPER.md](docs/WHITEPAPER.md) — Threat model, DSSS mathematics, and measured detection statistics.
* [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — Module hierarchy, signal processing pipelines, and data flow.
* [docs/USAGE.md](docs/USAGE.md) — Extended CLI, API, and band selection guide.
* [docs/PAYLOAD-FORMAT.md](docs/PAYLOAD-FORMAT.md) — Bit-level specification of codewords, CRC-16 polynomial, and modulation geometry.

---

## License & Commercial Use

Aureal Watermark is distributed under a **Dual License** model:

* **Personal, Academic, and Non-Commercial Use:** Free and open source under the [PolyForm Noncommercial License 1.0.0](LICENSE.md).
* **Commercial and Business Use:** A paid commercial license is required for any commercial entity, revenue-generating product, SaaS platform, corporate deployment, or monetized media pipeline.

To purchase a commercial license or discuss enterprise integration terms, please open an inquiry on the [GitHub Issues](https://github.com/KELLERBABG/Aureal-Watermark/issues) page or contact [@KELLERBABG](https://github.com/KELLERBABG).
