# Aural Watermark — Architecture

**Version:** 0.2.0 · ESM · Node ≥ 18 · zero npm dependencies (browser-safe core)

## Module map

```
bin/auralwatermark.js          CLI: gen / embed / detect
src/
  signal.js     deterministic DSP primitives:
                  hashSeed (FNV-1a), makeRng (xorshift128),
                  makeSymbolStream(key,label) → ±1,
                  hannWindow(n) cached,
                  BAND_PRESETS {high, mid}, resolveBand, bandList,
                  deriveGeometry(sampleRate, perChannelSamples) → slot/chip/frame/reps,
                  buildTemplate({key,sampleRate,geometry,band}) → template+slotNorms
  payload.js    packCodeword/unpackCodeword: uint32 ID ↔ 48 BPSK symbols
                with CRC-16/CCITT-FALSE; isValidPayloadId (uint32)
  embed.js      embedWatermark(pcm, fmt, opts) → new Float32Array + watermarkMeta
                validateFmt (shared with detect)
  detect.js     detectWatermark(pcm, fmt, opts): fold → resync → matched filter
                → CRC decode (+1-bit correction) → z-statistic confidence
  wav.js        parseWav/writeWav (buffers), readWavFile/writeWavFile (async fs)
  synth.js      synthesizeSpeechLike({seconds, sampleRate, channels})
  index.js      public API re-exports
  browser/
    aural-watermark-verify.js   verifyWav(arrayBuffer, expectedId, key, opts)
                                DataView RIFF parser, PCM 8/16/24/32-int + float32
demo/verifier.html              offline browser verification page (German UI)
test/
  wav.test.js watermark.test.js cli.test.js   v0.1 behavior (29 tests)
  codec.test.js   real ffmpeg MP3/AAC round-trips (11 tests, auto-skip w/o ffmpeg)
  browser.test.js verifier module against generated WAVs (2 tests)
```

## Embedding pipeline

```
opts {payloadId(uint32), key, strength=0.5, band="high"|"mid"|"dual"|{lowHz,highHz}}
  │
  ├─ validateFmt: sampleRate 8k..768k int, channels 1..8, length divisible
  ├─ bands = bandList(band)            dual → [high, mid], else single
  ├─ amp = strength × MAX_AMPLITUDE(0.12); multi-band ⇒ ×0.7 each
  ├─ geometry = deriveGeometry(rate, perChannel):
  │    frameSeconds 1.0 → slotLen ≈ rate/48 rounded to chip multiple
  │    chipLen = slotLen/24 ≥ 4, frameLen = slotLen×48, reps = ⌊len/frameLen⌋ ≥ 1
  ├─ codeword = packCodeword(payloadId)           // 32 data + 16 CRC bits
  └─ for band in bands:
       template = buildTemplate(...)               // keyed PN × Hann carrier bursts
       wm[off+n] += amp × codeword[b] × template[off+n]
  ▼
out = pcm ⊕ wm repeated `reps` times on every channel (identical frame →
mono downmix of stereo keeps the mark)
+ non-enumerable watermarkMeta {payloadId, key, strength, amplitude,
  peakWatermark, band(s), geometry}
```

Carrier construction (`buildTemplate`): each slot's chips are Hann-windowed
sine bursts at the band centre, sign-flipped by the keyed PN symbol → energy
stays inside the configured band; embed and detect build bit-identical
templates from `(key, sampleRate, geometry, band)` alone.

## Detection pipeline

```
opts {key, payloadId?, band="high"|"mid"|"dual"|"auto"|{lowHz,highHz}}
  │
  ├─ bands = bandList(band); "auto"/"dual" try both presets
  │
  │ for each band:
  │   for shift in resync grid {0, ±1/16, ±2/16, ±4/16}·frameLen (clamped ≤ frameLen/4):
  │     fold frames starting at `shift` over all channels → folded[frameLen]
  │     soft[b] = ⟨folded_b, template_b⟩ / (reps·channels·slotNorm_b)
  │     hard = sign(soft); decoded = unpackCodeword(hard)
  │     if !CRC: flip bits in |soft| ascending order until CRC ok (1-bit correction)
  │     refBits = expected codeword (verify) or own decision (blind)
  │     mu = mean(soft·refBits); sd; z = mu/denom
  │     confidence = clamp((z−3)/27, 0, 1)
  │   keep best-confidence hypothesis for the band
  │ winner = max over bands
  ▼
detected ⇔ crcOk ∧ idMatches ∧ confidence ≥ 0.5 ∧ mu > 0
result.details {mode, z, bandUsed, bandsTried, resyncShiftSamples, …}
```

Scale invariance: soft values are normalized by the template norm, so gain
changes cancel exactly.

## Band presets

| Preset | lowHz–highHz | center | Rationale |
|---|---|---|---|
| `high` | 16500–19500 | 18000 | least audible; may hit codec low-pass at ≤128 kbps |
| `mid` | 8000–13000 | 10500 | survives lossy low-pass filters; still above speech fundamentals |

Custom bands via `{lowHz, highHz}` are clamped to Nyquist−100 Hz.

## Browser verifier

`src/browser/aural-watermark-verify.js` imports only browser-safe modules
(no fs/Buffer anywhere in the graph). It re-implements WAV parsing on
DataView (RIFF walk, fmt/data chunks, WAVE_FORMAT_EXTENSIBLE aware) and
decodes PCM 8/16/24/32-bit integer and 32-bit float to interleaved
Float32Array, then calls the *same* `detectWatermark`.

```js
import { verifyWav } from "./src/browser/aural-watermark-verify.js";
const r = verifyWav(arrayBuffer, 1234567, "key", { band: "auto" });
// { detected, confidence, ber, bandUsed, reps }
```

`demo/verifier.html` is a zero-build static page using this module — works
from `file://`, all processing stays in the tab.

## CLI

```
gen    out.wav --seconds 30 [--rate 44100] [--channels 1] [--bits 16]
embed  in.wav out.wav --id <uint32> [--key s] [--strength 0..1]
       [--band high|mid|dual|lowHz:highHz]         # default: dual
detect in.wav [--id <uint32>] [--key s] [--json]
       [--band auto|high|mid|dual|lowHz:highHz]    # default: auto
```

Exit codes: `0` success/detected · `1` not detected · `2` hard error.
`detect --json` prints the full result incl. details (z, bandUsed, reps).

## Design decisions

1. **Keyed templates, not hidden data:** the audio carries ±PN patterns;
   without the key no correlator can be built. Keys are obfuscation-grade —
   documented honestly (see WHITEPAPER §6).
2. **Redundancy over cleverness:** same codeword in both bands beats exotic
   modulation; either band independently suffices for detection.
3. **Determinism everywhere:** seeded PRNG (FNV/xorshift), cached windows,
   fixed grids → identical results across platforms/runs, fully testable.
4. **One codebase, two runtimes:** the detection core never touches Node APIs,
   so the browser bundle cannot drift from the CLI behavior.
