# Aureal Watermark — Usage Guide

**Version:** 0.2.4 &bull; Node.js &ge; 18 &bull; Standalone Windows Executable & Universal Bundle

---

## 1. Desktop Studio App & CLI Quick Start

### Standalone Desktop Studio GUI
```powershell
# Launch the offline Desktop Studio application (Default)
auralwatermark
# or explicitly:
auralwatermark gui
```
Features interactive waveform visualization, recipient collision pre-checks, secure cryptographic ID generators, and multi-format audio export (WAV 16/24-bit and MP3 320/192/128k).

### CLI Usage
```powershell
# 1. Generate synthetic speech-like material for quick testing (no source audio needed)
node bin/auralwatermark.js gen podcast.wav --seconds 30 --rate 44100

# 2. Embed your tracking ID with a secret key (default: dual band)
node bin/auralwatermark.js embed podcast.wav podcast_marked.wav --id 1234567 --key secret

# 3. Verify an expected ID (Verify Mode: matched filter against expected ID)
node bin/auralwatermark.js detect podcast_marked.wav --id 1234567 --key secret
#   detected: YES / confidence: 1.000 / ber: 0.0% / band hit: high/mid (17000-19500 Hz)

# 4. Blind Detection (Auto-extracts and verifies any embedded watermark without passing an ID)
node bin/auralwatermark.js detect unknown.wav --key secret --json
```

**Exit Codes:** `0` detected &bull; `1` not detected &bull; `2` error.

---

## 2. CLI Commands & Options

### `gen <out.wav> [--seconds N] [--rate R] [--channels C] [--bits 16|24]`
Synthesizes speech-like audio with harmonic formants and amplitude envelope for testing and benchmarking.

### `embed <in.wav> <out.wav> --id <uint32> [--key s] [--strength 0..1] [--band dual|high|mid]`

| Option | Default | Description |
|---|---|---|
| `--id` | **Required** | Unsigned 32-bit tracking ID (`0` to `4294967295`). |
| `--key` | `aural-watermark-default-key` | Secret salt used for PRNG sequence generation. Must match at detection time. |
| `--strength` | `0.5` | Embedding amplitude scale (`0.01` to `1.0`). Inaudible and buried $\ge 32\text{--}36\text{ dB}$ below host audio. |
| `--band` | `dual` | `high` (17.0–19.5 kHz, ultrasonic), `mid` (8–13 kHz), `dual` (both bands), or custom `lowHz:highHz`. |

### `detect <in.wav> [--id <uint32>] [--key s] [--band auto|dual|high|mid] [--json]`

| Option | Default | Description |
|---|---|---|
| `--id` | *Omitted (Blind mode)* | When provided, runs targeted matched filter against the expected ID. |
| `--key` | `aural-watermark-default-key` | Secret salt matching the embedder. |
| `--band` | `auto` | Evaluates all bands and returns the highest-scoring match. |
| `--json` | `false` | Emits structured JSON diagnostics (BER, confidence, z-score, frame count). |

---

## 3. Web Studio & Offline Browser Verifier

Open `studio.html` or `demo/verifier.html` directly in any web browser (`file://` supported — zero build step, zero server required):

* **Verify Audio Tab:** Select or drop any audio file (MP3, WAV, AAC, M4A, OGG, FLAC) to extract or verify the provenance payload.
* **Embed Watermark Tab:** Select a source audio file, enter a 32-bit ID, choose the frequency band, and export the watermarked audio.

### Programmatic Browser API

```javascript
import { verifyAudioBuffer, verifyWav } from "./src/browser/aural-watermark-verify.js";

// Decode any audio format using Web Audio API
const ctx = new AudioContext();
const audioBuffer = await ctx.decodeAudioData(fileArrayBuffer);

// Verify AudioBuffer
const result = verifyAudioBuffer(audioBuffer, 1234567, "secret");
// Returns: { detected, confidence, ber, recoveredPayloadId, bandUsed, reps }
```

---

## 4. Node.js API

```javascript
import { embedWatermark, detectWatermark } from "aureal-watermark";
import { readWavFile, writeWavFile } from "aureal-watermark/src/wav.js";

const wav = await readWavFile("source.wav");
const fmt = { sampleRate: wav.sampleRate, channels: wav.channels };

// Embed
const watermarked = embedWatermark(wav.samples, fmt, {
  payloadId: 1234567,
  key: "secret",
  strength: 0.5,
  band: "dual"
});
await writeWavFile("tagged.wav", watermarked, { ...fmt, bitDepth: 16 });

// Detect
const res = detectWatermark(watermarked, fmt, {
  payloadId: 1234567,
  key: "secret",
  band: "auto"
});
```

---

## 5. Choosing a Deployment Band Profile

| Scenario | Recommended Band | Rationale |
| :--- | :--- | :--- |
| **Archival Masters / Lossless Distribution** | `high` | Complete inaudibility in near-ultrasound (17.0–19.5 kHz). |
| **Podcasts, Streaming, Social Media (MP3/AAC)** | `dual` (embed) + `auto` (detect) | Redundant encoding across mid and high bands survives encoder low-passes. |
| **Aggressive Codecs / Transcoded Video** | `mid` | Maximum codec margin (8–13 kHz) masked under speech sibilants and music transients. |

---

## 6. Running Tests

```powershell
# Run the complete test suite (42 tests, including lossy MP3/AAC ffmpeg round-trips)
node --test

# Run only the lossy codec round-trip suite
node --test test/codec.test.js
```
