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
Supports direct input and output in **WAV, MP3, FLAC, AAC, M4A, OGG, and AIFF** (via automatic FFmpeg fallback).

| Option | Default | Description |
|---|---|---|
| `--id` | **Required** | Unsigned 32-bit tracking ID (`0` to `4294967295`). |
| `--key` | `aural-watermark-default-key` | Secret salt used for PRNG sequence generation. Must match at detection time. |
| `--strength` | `0.5` | Embedding amplitude scale (`0.01` to `1.0`). Inaudible and buried $\ge 32\text{--}36\text{ dB}$ below host audio. |
| `--band` | `dual` | `high` (17.0–19.5 kHz, ultrasonic), `mid` (8–13 kHz), `dual` (both bands), or custom `lowHz:highHz`. |

### `detect <in.wav> [--id <uint32>] [--key s] [--band auto|dual|high|mid] [--json] [--report proof.json] [--report-txt cert.txt]`

| Option | Default | Description |
|---|---|---|
| `--id` | *Omitted (Blind mode)* | When provided, runs targeted matched filter against the expected ID. |
| `--key` | `aural-watermark-default-key` | Secret salt matching the embedder. |
| `--band` | `auto` | Evaluates all bands and returns the highest-scoring match. |
| `--json` | `false` | Emits structured JSON diagnostics (BER, confidence, z-score, frame count). |
| `--report` | *None* | Path to export a cryptographically sealed JSON forensic audit proof. |
| `--report-txt` | *None* | Path to export a human-readable ASCII certificate for DMCA/evidence exhibits. |

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

## 5. Air-Gapped Docker REST Microservice

Deploy an air-gapped, containerized REST daemon without external npm frameworks:

```bash
# Start microservice with Docker Compose (port 8080)
docker compose -f docker/docker-compose.yml up -d
```

### Endpoints:

#### `GET /v1/health`
Liveness and readiness probe:
```json
{
  "status": "ok",
  "service": "aureal-watermark-microservice",
  "version": "0.2.4",
  "uptimeSeconds": 142,
  "dsp": "active",
  "ffmpeg": true
}
```

#### `POST /v1/embed`
Accepts binary audio or JSON. Supports query params: `?id=1234567&strength=0.5&band=dual&format=mp3`.

```bash
curl -X POST "http://localhost:8080/v1/embed?id=1234567&format=mp3" \
  -H "Content-Type: audio/wav" \
  --data-binary @track.wav \
  --output watermarked.mp3
```

#### `POST /v1/detect`
Accepts binary audio or JSON. Supports optional `?id=...` and `?report=true`.

```bash
curl -X POST "http://localhost:8080/v1/detect?id=1234567&report=true" \
  -H "Content-Type: audio/mpeg" \
  --data-binary @watermarked.mp3
```

---

## 6. Cryptographic Forensic Proofs (`--report`)

When presenting audio leak evidence for copyright claims, DMCA notices, or legal review, export a tamper-evident audit report:

```bash
auralwatermark detect leak.mp3 --id 1234567 --report proof.json --report-txt cert.txt
```

The resulting `proof.json` includes:
* **Cryptographic Hashes:** SHA-256 and SHA-512 over the investigated file bytes.
* **Integrity Status:** `VERIFIED_AUTHENTIC`, `PAYLOAD_MISMATCH`, or `NO_WATERMARK_FOUND`.
* **Forensic Layer Metrics:** Raw $E_b/N_0$ (dB), SQNR (dB), Z-score, carrier bands, and CRC32 verification.
* **Anti-Tamper Seal:** Canonical HMAC-SHA256 signature over the report payload.

---

## 7. Choosing a Deployment Band Profile

| Scenario | Recommended Band | Rationale |
| :--- | :--- | :--- |
| **Archival Masters / Lossless Distribution** | `high` | Complete inaudibility in near-ultrasound (17.0–19.5 kHz). |
| **Podcasts, Streaming, Social Media (MP3/AAC)** | `dual` (embed) + `auto` (detect) | Redundant encoding across mid and high bands survives encoder low-passes. |
| **Aggressive Codecs / Transcoded Video** | `mid` | Maximum codec margin (8–13 kHz) masked under speech sibilants and music transients. |

---

## 8. Running Tests

```powershell
# Run the complete test suite (unit DSP, codecs, CLI, REST server, and forensic proofs)
node --test

# Run only the CLI and report suites
node --test test/cli.test.js test/report.test.js

# Run the REST microservice integration suite
node --test test/server.test.js
```
