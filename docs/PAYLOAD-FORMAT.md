# Aural Watermark — Payload & Signal Format

Normative reference for everything a second implementation must reproduce
bit-exactly. Version 0.2.7.

## 1. Payload codeword

```
bit layout (MSB first):  [ payloadId: 32 bits ][ CRC-16: 16 bits ] = 48 bits
```

- `payloadId`: unsigned 32-bit integer (`Number.isInteger`, `0 ≤ id ≤ 2^32−1`).
- CRC: **CRC-16/CCITT-FALSE** — poly `0x1021`, init `0xFFFF`, refin false,
  refout false, xorout `0x0000` — computed over the 4 ID bytes, big-endian.
- The 48 bits map to 48 BPSK symbols: bit `1 → +1`, bit `0 → −1`
  (`packCodeword` / `unpackCodeword` in `src/payload.js`).

Error correction at detection: if the CRC of the hard-decided codeword fails,
it first flips bits one at a time in ascending |soft amplitude| order until the
CRC passes (1-bit correction). If that fails, it sweeps all pairs drawn from the
8 lowest-confidence symbols (28 trials) and accepts the first pair whose CRC
passes (2-bit correction). Errors beyond that are not corrected.

## 2. Keys and PN sequences

- Key string: arbitrary non-empty; default `"aural-watermark-default-key"`.
- Per symbol slot b ∈ {0…47}: stream label `"bit" + b`.
- PRNG chain: seed string → FNV-1a 32-bit hash → four salted words
  (`0x9e3779b9, 0x85ebca6b, 0xc2b2ae35, 0x27d4eb2f`, each mixed with
  murmur-style finalizer) → xorshift128 output stream.
- Symbol stream: `rng() < 0.5 ? −1 : +1`.

Both embedder and detector derive identical sequences from `(key, label)`
alone; nothing key-dependent is stored in the file.

## 3. Frame geometry

Given sample rate `R`, per-channel length `N`:

| Quantity | Formula |
|---|---|
| target slot length | `round(1.0 s × R / 48)` |
| chip length `C` | `max(4, ⌊slotLen/24⌋)` |
| slot length `S` | `24 × C` (snapped) |
| frame length `F` | `48 × S` (~1 s) |
| repetitions | `⌊N/F⌋`, must be ≥ 1 |

## 4. Band presets

| Preset | lowHz–highHz | center used for carrier |
|---|---|---|
| high | 17000–19500 | 18250 |
| mid | 4500–13500 | 9000 |

Custom `{lowHz, highHz}` is honoured as the only band and clamped by
`resolveBand()` to `[1000, R/2−100]`; it throws a `RangeError` when it cannot fit
under Nyquist or is narrower than 200 Hz. Presets that do not fit at low sample
rates fall back to one wide band (`dual` degrades to the presets that fit). The
carrier sits at the band center; Hann-windowed chips confine energy well inside
the band.

## 5. Watermark signal

For symbol slot b, chips c ∈ {0…23} (chip length C), sample j ∈ [0,C):

```
wm[b·S + c·C + j] = amp · symbol_b · hann[j] · sin(2π·f_center·j/R)
symbol_b          = ±1 from keyed PN stream "bit"+b
```

Embedding adds this frame repeatedly (`reps`) across channels with Mid/Side
decorrelation. Adaptive proportional masking tracks slot RMS, burying the signal
≥32–36 dB below host audio and muting completely on silence (≤ -54 dBFS). Scale
factor: `amp = max(0.001, strength) × 0.0085`, ×0.85 when
both bands are used, and the mid-band copy is additionally ×0.42. `amp` is a
nominal per-band level, not a peak bound: at strength 0.5 dual band the measured
output was ≈ −41 dBFS peak / −57 dBFS RMS on a speech-like fixture.

## 6. Detection statistics

- Fold all frames (summed over channels) starting at resync offset
  `s ∈ {0, ±F/16, ±F/8, ±F/4}` clamped to `[0, F/4]`.
- Soft symbol: `soft[b] = ⟨folded_b, template_b⟩ / (reps · channels · ‖template_b‖²)`.
- Confidence: `clamp((z − 3)/27, 0, 1)` with z from mean/spread of
  `soft[b]·ref[b]`. `detected` requires a valid CRC, an ID match (in verify
  mode) and `mu > 0`; the confidence threshold applied is 0.35 when the CRC is
  valid (0.5 is the fallback when it is not, which can never yield `detected`).
- Winner across bands/keys = the CRC-valid hypothesis if one exists, otherwise
  the highest-confidence one (a CRC-failing hypothesis with a higher confidence
  never beats a CRC-valid one).

A compatible implementation reproduces `detected`, `confidence`, `ber`,
and `recoveredPayloadId` exactly for any given WAV and key.

## 7. Worked example

```bash
node bin/auralwatermark.js gen t.wav --seconds 20 --rate 44100
node bin/auralwatermark.js embed t.wav wm.wav --id 1234567 --key geheim
node bin/auralwatermark.js detect wm.wav --id 1234567 --key geheim --json
# → detected true, confidence ~1.0, ber 0%, recovered id 1234567
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for pipeline context and
[WHITEPAPER.md](WHITEPAPER.md) §6 for what this format does *not* guarantee
(no cryptographic forgery resistance yet).
