# Aural Watermark

**Domain:** Media / Audio Provenance — literally separate
**One-liner:** Inaudible watermark for human voice. Prove podcast/interview is not AI-cloned. Verify in browser.

**Buyer:** Podcast networks, radio, labels, courts (audio evidence)
**Why easy to sell:** AI voice cloning lawsuits exploding 2026; EU AI Act requires provenance. SDK 0.02 EUR/min, no infra.
**Tech:** Python + audiomentations, spread-spectrum watermark (18-20kHz + phase), Web WASM verifier. Not blockchain.
**Not developed:** Watermarking for voice provenance exists in labs, not as 1-click creator tool.
**Standalone:** No mesh, no OS, no FHE.

---

## Documentation

- [docs/WHITEPAPER.md](docs/WHITEPAPER.md) — provenance problem, spread-spectrum approach, measured codec robustness, threat model, roadmap
- [docs/USAGE.md](docs/USAGE.md) — CLI + JS API + browser verifier guide, band-mode selection
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — module map, embed/detect pipelines, design decisions
- [docs/PAYLOAD-FORMAT.md](docs/PAYLOAD-FORMAT.md) — normative bit-level spec: codeword, CRC, PN keys, geometry, statistics

## MVP (v0.2)

**Neu in v0.2 — Lossy-Codec-Überleben, Resync, Browser-Verifier:**

- **Band-Modi:** `high` (16.5–19.5 kHz), neu `mid` (8–13 kHz) und `dual`
  (beide Bänder redundant, gleiches Codewort, gleicher Schlüssel).
  CLI: `embed --band dual` (neuer Default), `detect --band auto` (probiert
  beide, behält die beste Konfidenz, meldet `band hit`).
- **Resync-Suche:** Detektor testet grobe Frame-Verschiebungen
  (±1/16 … ±4/16 Framelänge) und wählt das beste Hypothesenfenster — absorbiert
  kleine Sample-Offsets nach Dekodierung/Zuschnitt.
- **Browser-Verifier:** `src/browser/aural-watermark-verify.js` (zero-dep,
  DataView-basiert) + fertige Demo-Seite `demo/verifier.html` — Datei wählen,
  ID + Schlüssel eingeben, läuft komplett lokal im Browser (file:// tauglich).

**Gemessene Codec-Robustheit** (ffmpeg real encode→decode, 20 s synthetisch,
strength 0.5, Konfidenz jeweils ≥ 0.5, `node --test test/codec.test.js`):

| Embed-Band | MP3 128k | MP3 320k | AAC 128k |
|---|---|---|---|
| high | ✔ | ✔ | ✔ |
| mid  | ✔ | ✔ | ✔ |
| dual | ✔ | ✔ | ✔ |

42 Tests gesamt (`node --test`, inkl. 11 echter ffmpeg-Codec-Roundtrips).

**Weiterhin offen:** Time-Stretch/Pitch-Shift, Bitraten <96 kbps, Schlüssel sind
Obfuscation-Grade (FNV/xorshift, nicht kryptografisch), Payload ist opaker uint32
(keine Signaturen). Robustheit gemessen auf synthetischem Sprachmaterial.

## MVP (v0.1)

Working core DSP engine + CLI in dependency-free ESM JavaScript (Node stdlib only).
Embeds a provenance ID into audio inaudibly; anyone holding the key can verify later.
Browser/WASM verifier is **not** part of this milestone.

### Install / run

```bash
# no npm installs required; Node >= 18
node --test                      # run the test suite (29 tests, ~7 s)

node bin/auralwatermark.js help  # CLI usage
```

### CLI usage

```bash
# 1. Generate synthetic speech-like material (so demos need no source audio)
node bin/auralwatermark.js gen test.wav --seconds 30 --rate 44100

# 2. Embed payload id 1234567 with a secret key at default strength
node bin/auralwatermark.js embed test.wav watermarked.wav --id 1234567 --key secret

# 3a. Verify expected id (primary mode) -> exit code 0 on success
node bin/auralwatermark.js detect watermarked.wav --id 1234567 --key secret
#   detected: YES / confidence: 1.000 / ber: 0.0% (0/48 bits)

# 3b. Wrong id is rejected -> exit code 1
node bin/auralwatermark.js detect watermarked.wav --id 7654321 --key secret

# 3c. Blind/open detection: no id given, decodes bits and validates CRC
node bin/auralwatermark.js detect watermarked.wav --key secret --json
```

Exit codes: `0` detected · `1` not detected · `2` error.
Options: `--strength 0..1` (embed loudness, default 0.5), `--band lowHz:highHz` (default 16500:19500), `--rate`, `--channels`, `--bits` (gen), `--json` (detect).

### JS API usage

```js
import { embedWatermark, detectWatermark } from "auralwatermark/src/index.js";
import { readWavFile, writeWavFile } from "auralwatermark/src/wav.js";

const wav = await readWavFile("episode.wav");
const fmt = { sampleRate: wav.sampleRate, channels: wav.channels };

const marked = embedWatermark(wav.samples, fmt, {
  payloadId: 1234567,       // uint32
  key: "network-secret",
  strength: 0.5,
});
await writeWavFile("episode-marked.wav", marked, { ...fmt, bitDepth: 16 });

const result = detectWatermark(marked, fmt, { key: "network-secret", payloadId: 1234567 });
// { detected: true, confidence: 0..1, ber, recoveredPayloadId, crcOk, reps, details }
```

### Technical approach

- **Codeword**: 32-bit payload ID + 16-bit CRC-16/CCITT-FALSE = 48 BPSK symbols (+1/-1).
- **Spreading**: each symbol is carried by its own pseudorandom ±1 chip sequence
  (24 chips/slot, xorshift128 PRNG keyed by FNV-1a of `key|bitN`). Chips are
  Hann-windowed carrier bursts at the band centre (~18 kHz), so all watermark
  energy is confined to roughly ±200 Hz around 18 kHz — safely inside the
  configurable 16.5–19.5 kHz guard band and below the audibility threshold,
  especially under speech.
- **Framing**: one codeword repetition occupies ~1 s (`frameLen` samples); the
  template repeats across the whole track. The detector folds every repetition
  onto a single frame before correlating → coherent integration gain grows with
  track length (30 s ⇒ 30× amplitude SNR vs a single frame).
- **Detection statistics**: per-symbol matched-filter amplitudes → mean/spread
  z-score mapped to confidence 0..1; scale-invariant (gain changes cancel).
  Decision = CRC valid AND id matches AND confidence ≥ 0.5. A single bit error
  is corrected via reliability-ordered flips before CRC validation.
- **Channels**: identical watermark added to every channel; survives mono
  downmixes. WAV I/O supports 16/24-bit PCM read/write, 8/32-bit int and float
  read, mono/stereo/multichannel, WAVE_FORMAT_EXTENSIBLE, chunk padding.

### Verified robustness (measured in this repo's test suite)

| Scenario | Result |
| --- | --- |
| Clean embed → detect (12 s, 48 kHz mono) | detected, BER 0 %, confidence > 0.99 |
| Blind decode without expected id | recovers exact ID via CRC |
| Unwatermarked audio | detected NO, confidence ≈ 0.00 |
| Wrong ID / wrong key | detected NO, confidence ≈ 0.00 |
| Additive white noise @ −30 dBFS RMS | still detected, BER 0 %, conf > 0.8 |
| Gain ×0.5 (and ×2 with clipping) | still detected, BER 0 % |
| Stereo embed/detect; 44.1 k & 48 k | pass |

Demo measured values (30 s clip): correct-ID detect `confidence 1.000, BER 0.0%`;
wrong-ID detect `confidence 0.000, BER 37.5%`; blind mode z-statistic ≈ 986.

### Limitations (known, deliberate for MVP)

- **Lossy survival NOT yet guaranteed**: MP3/AAC re-encode typically keeps
  content above 16 kHz only at high bitrates; low-bitrate codecs low-pass at
  or below the watermark band and will destroy it. Robustness testing against
  codec pipelines (and band agility to dodge codec cut-offs) is next.
- No resilience yet to resampling, time-stretch/pitch-shift, or severe
  desync — detection assumes sample alignment.
- Keys use non-cryptographic hashes (FNV-1a/xorshift128); fine for
  obfuscation, not adversarial security. Payload is an opaque uint32 — no
  signature/payload encryption yet.
- Default watermark level (−24 dBFS peak at strength 0.5) is conservative;
  psychoacoustic adaptive shaping not implemented.
- Detector confidence calibration uses empirical z-mapping, not a formal
  false-positive model (CRC gate keeps practical FP rate ≈ 2⁻¹⁶ per trial).

### Roadmap

1. **Browser WASM verifier** — compile this engine (or a C port) to WASM;
   drag-and-drop verification page. ← next step
2. Lossy-codec survival: lower band option, codec-aware band hopping,
   ECC (e.g. BCH/Hamming) instead of bare CRC.
3. Sync robustness: cross-correlation search over time/scale offsets.
4. Signed payloads (Ed25519 over ID+metadata) for court-grade evidence.
5. Streaming embedder (chunk-wise, constant memory) + ffmpeg plugin,
   SDK packaging at 0.02 EUR/min price point.
