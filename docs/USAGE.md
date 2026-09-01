# Aural Watermark — Usage Guide

**Version:** 0.2.0 · Node ≥ 18 · zero dependencies · ffmpeg optional (only for
the codec test suite)

## CLI quick start

```powershell
# 1. generate synthetic speech-like material (no source audio needed)
node bin/auralwatermark.js gen podcast.wav --seconds 30 --rate 44100

# 2. embed your provenance id with a secret key (default: dual band)
node bin/auralwatermark.js embed podcast.wav podcast-marked.wav --id 1234567 --key geheim

# 3. verify — expected id, matched filter
node bin/auralwatermark.js detect podcast-marked.wav --id 1234567 --key geheim
#   detected: YES / confidence: 1.000 / ber: 0.0% / band hit: …

# blind mode (no --id): decodes bits + CRC, recovers the id
node bin/auralwatermark.js detect unknown.wav --key geheim --json
```

Exit codes: `0` detected · `1` not detected · `2` hard error.

## Commands & options

### `gen out.wav [--seconds N] [--rate R] [--channels C] [--bits 16|24]`
Synthesizes a speech-like tone (harmonics + AM envelope) for demos/tests.

### `embed in.wav out.wav --id <uint32> [--key s] [--strength 0..1] [--band …]`

| Option | Default | Notes |
|---|---|---|
| `--id` | required | unsigned 32-bit provenance id |
| `--key` | built-in default | selects the PN sequences; must match at detect time |
| `--strength` | 0.5 | perceptual strength; peak ≈ −18 dBFS at 1.0 |
| `--band` | `dual` | `high` 16.5–19.5 kHz · `mid` 8–13 kHz (codec-safe) · `dual` both · or `lowHz:highHz` |

### `detect in.wav [--id <uint32>] [--key s] [--band auto|…] [--json]`

| Option | Default | Notes |
|---|---|---|
| `--id` | blind mode if omitted | verify mode uses matched filter against expected id |
| `--band` | `auto` | tries high+mid and keeps the best result; reports which band hit |
| `--json` | – | full machine-readable result incl. `details.bandUsed`, `z`, reps |

## Browser verifier (offline)

Open `demo/verifier.html` directly (`file://` works — no build step, no
server): pick the WAV, enter the expected ID (+ key if used), press *Prüfen*.
The audio never leaves the browser tab.

Programmatic use:

```js
import { verifyWav } from "./src/browser/aural-watermark-verify.js";

const buf = await file.arrayBuffer();
const r = verifyWav(buf, 1234567, "geheim");   // {detected, confidence, ber, bandUsed}
```

Supported containers: PCM WAV (8/16/24/32-bit int, 32-bit float,
WAVE_FORMAT_EXTENSIBLE). Compressed audio must be decoded to WAV first
(the CLI tests do exactly this via ffmpeg).

## JavaScript API (Node)

```js
import { embedWatermark } from "./src/embed.js";
import { detectWatermark } from "./src/detect.js";
import { readWavFile, writeWavFile } from "./src/wav.js";

const wav = await readWavFile("in.wav");
const marked = embedWatermark(wav.samples,
  { sampleRate: wav.sampleRate, channels: wav.channels },
  { payloadId: 1234567, key: "geheim", strength: 0.5, band: "dual" });

const res = detectWatermark(marked,
  { sampleRate: wav.sampleRate, channels: wav.channels },
  { payloadId: 1234567, key: "geheim", band: "auto" });
// res.detected, res.confidence, res.ber, res.recoveredPayloadId,
// res.details.bandUsed, res.details.resyncShiftSamples …
```

## Choosing a band mode

| Scenario | Recommendation |
|---|---|
| archival masters, lossless distribution only | `high` |
| distribution through MP3/AAC pipelines (podcasts!) | `dual` (embed) + `auto` (detect) |
| maximum codec margin, slight audibility budget on non-voice content | `mid` |

## Tests

```powershell
node --test                    # full suite incl. real ffmpeg codec round-trips (~65 s)
node --test test/codec.test.js # only the MP3/AAC survival suite (skips w/o ffmpeg)
```

Measured results table: [WHITEPAPER.md](WHITEPAPER.md) §5.
Bit-level format spec: [PAYLOAD-FORMAT.md](PAYLOAD-FORMAT.md).

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `audio too short for watermarking` | need ≥ one full ~1 s frame per channel; use longer material |
| detected NO despite marking | wrong key/id, or audio was time-stretched/pitch-shifted; try `--band auto` |
| confidence low after heavy processing | increase embed `--strength`; prefer `dual`; see WHITEPAPER §6 limits |
