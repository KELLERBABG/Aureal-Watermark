# Aureal Watermark — Technical & Engineering Code Roadmap

> **Audit Date:** September 11, 2026  
> **Repository:** `C:\Users\INTAL Admin\SYSTEMS & CREATIONS\Aural Watermark`  
> **Target Version:** `v0.2.5+`  
> **Focus:** 100% Code, DSP, CLI, Types, and CI/CD Architecture (Excluding Legal/Operational)

---

## 1. Executive Summary of Code Health

| Subsystem | State | Health | Key Observations |
| :--- | :---: | :---: | :--- |
| **Core DSP Engine** (`src/signal.js`, `src/embed.js`, `src/detect.js`) | Complete | **9.5/10** | DSSS modulation, dual bands (8-13k & 17-19.5k), circular modulo folding, rake receiver. 56 tests pass. |
| **Licensing Subsystem** (`src/license.js`) | Complete | **9.0/10** | Polar.sh validation, offline caching (`~/.aureal/license.json`), key sanitization, zero plain keys stored. |
| **Audio File Ingestion** (`src/wav.js`) | Partial | **6.5/10** | Uncompressed PCM WAV only (8/16/24/32-bit int & float). Missing native FLAC/MP3/AIFF auto-transcoding. |
| **TypeScript Developer Experience** (`types/`) | Missing | **0/10** | Pure ESM JavaScript. No `.d.ts` declaration bundle or JSDoc type exports for B2B/TypeScript consumers. |
| **Cross-Platform Binary Automation** (`.github/workflows/`) | Partial | **5.0/10** | Single Executable Application (SEA) built only on Windows (`.exe`). macOS (ARM64/x64) and Linux missing. |
| **Container & Cloud Microservice** (`docker/`) | Missing | **0/10** | No headless containerized REST microservice template (`POST /embed`, `POST /detect`) for air-gapped clusters. |

---

## 2. Deep Dive: Missing Technical Features

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                               AUREAL WATERMARK SYSTEM                                 │
├──────────────────────────────┬──────────────────────────────┬──────────────────────────┤
│        [1. CLI & DX]         │          [2. CORE]           │      [3. RELEASE]        │
│                              │                              │                          │
│ • Universal Audio Ingestion  │ • TypeScript Declarations    │ • Cross-Platform SEA     │
│   (Auto-ffmpeg pipe for MP3, │   (`types/index.d.ts`)       │   (Linux ELF & macOS     │
│    FLAC, AAC, OGG, AIFF)     │ • 32-bit Float WAV Exporter  │    Universal Mach-O)     │
│ • JSON/Audit Report Output   │ • Batch Worker Thread Pool   │ • Container Microservice │
│   for legal & DMCA disputes  │   for multi-track stems      │   (FastAPI/Express Air-  │
│                              │                              │    gapped REST Docker)   │
└──────────────────────────────┴──────────────────────────────┴──────────────────────────┘
```

---

### Gap 1: Universal Audio File Ingestion in CLI (`bin/auralwatermark.js`)
* **Problem:** Currently, running `auralwatermark embed track.mp3` or `auralwatermark detect stem.flac` crashes with:
  ```
  WavError: not a RIFF/WAVE file
  ```
  The user is forced to manually open a terminal and run `ffmpeg -i track.mp3 temp.wav`, run Aureal, and then re-encode.
* **Implementation Plan:**
  1. In `bin/auralwatermark.js`, check the file extension or header magic bytes.
  2. If the file is not uncompressed WAV, check if `ffmpeg` is available via `execFileSync("ffmpeg", ["-version"])`.
  3. If available, transparently transcode to an in-memory/temp WAV stream, run the watermark DSP, and transcode back to the requested target container format.
  4. If `ffmpeg` is not present, print an actionable, clean terminal error guiding the user.

---

### Gap 2: First-Class TypeScript Type Definitions (`types/index.d.ts`)
* **Problem:** B2B platforms, Voice AI platforms, and enterprise Node.js developers importing `aureal-watermark` receive zero autocomplete or type definitions (`any`).
* **Implementation Plan:**
  1. Create `types/index.d.ts` defining:
     ```typescript
     export interface WatermarkOptions {
       payloadId: number;
       key?: string;
       strength?: number;
       band?: "high" | "mid" | "dual" | "auto" | { lowHz: number; highHz: number };
     }

     export interface WatermarkMetadata {
       key: string;
       payloadId: number;
       strength: number;
       bands: Array<{ lowHz: number; highHz: number }>;
       peakWatermark: number;
       geometry: { slotLen: number; frameLen: number; reps: number; bits: number };
     }

     export interface DetectionResult {
       detected: boolean;
       recoveredPayloadId: number | null;
       confidence: number;
       ber: number;
       ebN0Db: number;
       sqnrDb: number;
       details: {
         mode: string;
         bandUsed: { lowHz: number; highHz: number } | null;
         bandsTried: number;
         bits: number;
         bitsCorrected?: number[];
       };
     }

     export function embedWatermark(
       pcm: Float32Array,
       fmt: { sampleRate: number; channels: number },
       opts: WatermarkOptions
     ): Float32Array & { watermarkMeta: WatermarkMetadata };

     export function detectWatermark(
       pcm: Float32Array,
       fmt: { sampleRate: number; channels: number },
       opts?: { key?: string; payloadId?: number; band?: string | { lowHz: number; highHz: number } }
     ): DetectionResult;

     export function readWavFile(path: string): Promise<{
       sampleRate: number;
       channels: number;
       bitsPerSample: number;
       numFrames: number;
       durationSec: number;
       samples: Float32Array;
       format: string;
     }>;

     export function writeWavFile(
       path: string,
       samples: Float32Array,
       fmt: { sampleRate: number; channels: number; bitDepth?: 16 | 24 | 32 }
     ): Promise<void>;
     ```
  2. Add `"types": "./types/index.d.ts"` to `package.json`.

---

### Gap 3: Cross-Platform Single Executable Workflows (Linux & macOS)
* **Problem:** In `.github/workflows/release.yml`, the build matrix only builds for Windows:
  ```yaml
  jobs:
    build:
      runs-on: windows-latest
  ```
  Users on Linux (Ubuntu, Debian, Arch) and macOS (Apple Silicon M1/M2/M3/M4 & Intel) currently have to run Node.js manually instead of having a native standalone binary.
* **Implementation Plan:**
  1. Update `.github/workflows/release.yml` with a matrix:
     ```yaml
     strategy:
       matrix:
         include:
           - os: windows-latest
             artifact: aureal-watermark.exe
           - os: ubuntu-latest
             artifact: aureal-watermark-linux-x64
           - os: macos-latest
             artifact: aureal-watermark-macos-universal
     ```
  2. For macOS, use `codesign` (ad-hoc `-s -`) and combine ARM64 + x64 with `lipo -create`.
  3. Upload native standalone binaries for all three platforms on tag releases.

---

### Gap 4: Air-Gapped Microservice & Container Architecture (`docker/`)
* **Problem:** Enterprise audio platforms and Voice AI companies (ElevenLabs, Suno, Epidemic Sound models) run containerized pipelines on Kubernetes, AWS ECS, or Nomad. Calling a CLI subprocess from Python/Go backends creates process fork overhead.
* **Implementation Plan:**
  1. Add `docker/Dockerfile`:
     - Minimal Alpine / Debian-slim base with Node.js 22 and lightweight `ffmpeg`.
     - Zero phone-home network permissions needed (air-gapped ready).
  2. Add `docker/server.js`:
     - Lightweight zero-dependency HTTP REST daemon (`http.createServer`).
     - `POST /v1/embed` (accepts binary PCM/WAV + JSON query params, returns watermarked audio).
     - `POST /v1/detect` (accepts binary PCM/WAV, returns forensic confidence, BER, and recovered ID).
     - `GET /v1/health` (liveness probe).
  3. Add `docker-compose.yml` for 1-command deployment:
     ```bash
     docker compose up -d
     ```

---

### Gap 5: Forensic Proof Certificate Generator (`src/report.js`)
* **Problem:** When a user detects a leak or proves synthetic audio origin in a dispute, they need a portable, tamper-evident document or structured audit object that can be passed to copyright enforcement, DMCA agents, or legal counsel.
* **Implementation Plan:**
  1. Implement `generateForensicReport(detectionResult, audioMetadata)` returning a standardized JSON schema:
     - Cryptographic SHA-256 hash of the analyzed audio file.
     - Extracted 32-bit watermark ID and verification status.
     - Bit Error Rate (BER), Energy-per-Bit ($E_b/N_0$), and Signal-to-Quantization-Noise Ratio (SQNR).
     - Matched-filter sync method and timestamp.
     - Digital signature over the report payload using a local private key.
  2. Expose in CLI: `auralwatermark detect leak.wav --report leak_report.json`.

---

## 3. Prioritized Implementation Order

| Step | Technical Feature | Impact | Files Affected |
| :---: | :--- | :---: | :--- |
| **1** | **TypeScript Definitions (`types/index.d.ts`)** | Highest DX & Autocomplete | `types/index.d.ts`, `package.json` |
| **2** | **CLI Universal Format Ingestion (FFmpeg fallback)** | Eliminates user format friction | `bin/auralwatermark.js`, `src/wav.js` |
| **3** | **macOS & Linux Single Executable Release CI** | Broadens OS distribution | `.github/workflows/release.yml` |
| **4** | **Air-Gapped Docker REST Microservice Template** | Enterprise B2B & TTS Platforms | `docker/Dockerfile`, `docker/server.js` |
| **5** | **Forensic Audit Report Export (`--report`)** | Legal & Anti-theft verification | `src/report.js`, `bin/auralwatermark.js` |
