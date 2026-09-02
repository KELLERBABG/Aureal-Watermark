# Aural Watermark — Payload & Signal Format

Normative reference for everything a second implementation (e.g. the WASM
verifier) must reproduce bit-exactly. Version 0.2.1.

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
bits are flipped one at a time in ascending |soft amplitude| order until the
CRC passes (single-error correction). Multi-bit errors fail cleanly.

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
| high | 16500–19500 | 18000 |
| mid | 8000–13000 | 10500 |

Custom `{lowHz, highHz}` is clamped to `[1000, R/2−100]`. The carrier sits
at the band center; Hann-windowed chips confine energy well inside the band.

## 5. Watermark signal

For symbol slot b, chips c ∈ {0…23} (chip length C), sample j ∈ [0,C):

```
wm[b·S + c·C + j] = amp · symbol_b · hann[j] · sin(2π·f_center·j/R)
symbol_b          = ±1 from keyed PN stream "bit"+b
```

Embedding adds this frame repeatedly (`reps`) on every channel at identical
positions; multi-band modes sum independently scaled copies
(each ×0.7). Peak amplitude bound: `amp = strength × 0.12`,
multi-band ×0.7 each.

## 6. Detection statistics

- Fold all frames (summed over channels) starting at resync offset
  `s ∈ {0, ±F/16, ±F/8, ±F/4}` clamped to `[0, F/4]`.
- Soft symbol: `soft[b] = ⟨folded_b, template_b⟩ / (reps · channels · ‖template_b‖²)`.
- Confidence: `clamp((z − 3)/27, 0, 1)` with z from mean/spread of
  `soft[b]·ref[b]`; detection threshold 0.5 plus positive alignment.
- Winner across bands = highest confidence.

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
