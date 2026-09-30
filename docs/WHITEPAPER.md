# Aureal Watermark Whitepaper

**Version:** 0.2.6 &bull; **Status:** Technical overview; benchmark results are limited to named local fixtures

> A spread-spectrum audio watermarking implementation for embedding and recovering keyed identifiers in audio. A match does not prove authorship, ownership, identity, or origin.

---

## 1. Abstract

With the proliferation of realistic voice-cloning models, deepfake audio and unauthorized voice scraping have become significant legal and commercial liabilities. High-profile podcast hosts, voice actors, musicians, and executives frequently find their voices cloned or leaked without consent. While regulatory frameworks like the EU AI Act mandate provenance transparency for synthetic media, this document describes one experimental approach to embedding identifiers; it does not authenticate a human creator or prove that a recording is original.

Aureal Watermark embeds a 32-bit provenance tracking identifier directly into the audio waveform during recording, mastering, or distribution. The signal is modulated as a Direct-Sequence Spread Spectrum (DSSS) carrier across strictly near-ultrasonic bands (17.0–19.5 kHz) and A-weighted speech-masked mid-bands (8–13 kHz). The payload includes a CRC-16 checksum and uses repeated symbols and error correction. Recovery depends on audio content and transformations.

Selected local `ffmpeg` fixtures exercise MP3/AAC transcodes and mismatched IDs. These tests do not guarantee recovery across all encoders, content, bitrates, or services.

---

## 2. Problem & Market

| Industry Reality | Market Consequence |
| :--- | :--- |
| **Voice cloning takes minutes instead of weeks** | Verifiable authenticity becomes a primary commercial asset for human productions. |
| **EU AI Act & Global Regulatory Mandates** | Broadcasters, studios, and publishers require verifiable provenance documentation. |
| **Existing watermarking research is locked in proprietary labs** | Creators lack an instant, zero-dependency, 1-click offline attribution tool. |

**Primary Buyers:** Podcast networks, radio broadcasters, record labels, legal evidence archives, and voice talent agencies.
**Cost Structure:** The CLI and browser demo process audio locally within their respective environments. Hosting, external assets, and license activation may involve network requests.

---

## 3. Technical Approach

### 3.1 Codeword Architecture

```
Payload ID (uint32) ──► CRC-16/CCITT-FALSE ──► 48 BPSK Symbols ──► PN Carrier Slots
[32 Data Bits]          [16 Checksum Bits]      [1 Symbol per Slot]
```

Each of the 48 symbols is modulated by an independent $\pm 1$ pseudorandom noise (PN) sequence derived from the secret key via `makeSymbolStream(key, "bit" + b)`. Without the key, the carrier sequence acts as uncorrelated white noise across the frequency domain.

### 3.2 Signal Modulation & Embedding

For each symbol slot (24 chips), a Hann-windowed sinusoidal carrier burst at the band center is multiplied by the PN chip sign. Energy is strictly confined within the configured band; one complete codeword spans exactly one frame (~1.0 second), repeating continuously across the track duration. This provides coherent integration gain with every additional second of audio.

**Configured Profiles (audibility and recovery are content-dependent):**

| Mode | Carrier Band | Characteristics |
| :--- | :--- | :--- |
| `high` | 17.0–19.5 kHz | Places energy in a near-ultrasonic band; audibility and recovery depend on source material and playback equipment. |
| `mid` | 8.0–13.0 kHz | Uses a mid-frequency band; recovery depends on the audio and the codec's frequency response. |
| `dual` | Both bands | Embeds in both configured bands; the detector scores the available bands. This does not guarantee recovery after processing. |

In `dual` mode, the embedder scales each copy with configured attenuation to set $\times 0.7$ with A-weighted attenuation on the mid band to set configured band levels ($-51\text{--}-55\text{ dBFS}$ nominal level).

### 3.3 Detection Pipeline

1. **Repetition Stacking (Folding):** All 1-second frames across all channels are folded into a single composite frame, multiplying the signal-to-noise ratio (SNR) with track length.
2. **Resynchronization Grid:** To absorb fractional sample offsets caused by lossy decoders, the detector evaluates shift hypotheses across $\pm 1/16, \pm 2/16, \pm 4/16$ frame lengths.
3. **Matched Filtering:** Computes the normalized dot-product of each slot against the keyed PN template to obtain soft-decision values.
4. **Error Correction:** Decodes hard bit values and validates the CRC-16 checksum. If CRC fails, bits are flipped in ascending order of soft amplitude magnitude (1-bit error correction).
5. **Statistical Verification:** Computes the $z$-score of aligned amplitude against variance:
   $$\text{confidence} = \text{clamp}\left(\frac{z - 3.0}{27.0}, 0.0, 1.0\right)$$
6. **Verdict Rule:**
   $$\text{detected} \iff \text{CRC Valid} \land \text{ID Matches} \land \text{confidence} \ge 0.5 \land \mu > 0$$

---

## 4. Evaluation & Measured Benchmarks

The current automated suite contains Node tests and selected local `ffmpeg` fixtures. Fixture coverage and outcomes are specific to their synthetic inputs and configured transformations; they are not a broad real-world benchmark.

| Carrier Band | MP3 128k | MP3 320k | AAC 128k | Additive Noise (−30 dBFS) | Gain Shift (0.5× / 2.0×) |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **High** | Fixture tested | Fixture tested | Fixture tested | Fixture tested | Fixture tested |
| **Mid** | Fixture tested | Fixture tested | Fixture tested | Fixture tested | Fixture tested |
| **Dual** | Fixture tested | Fixture tested | Fixture tested | Fixture tested | Fixture tested |

* **Rejection Accuracy:** Unmarked audio, wrong secret keys, and mismatched expected IDs are rejected with $0.0\%$ confidence.
* **Blind Recovery:** Recovers embedded 32-bit payloads without prior ID knowledge via CRC-16 validation.
* **Clean-Path Fidelity:** $100\%$ confidence with $0.0\%$ Bit Error Rate on lossless passes.

---

## 5. Threat Model & Explicit Boundaries

### Selected Fixture Results
* **Keyed ID Detection:** A matching watermark ID is one signal that can be compared with independently maintained distribution records; it does not prove origin or attribution.
* **Adversarial Channel Resilience:** Was detected in a synthetic mid/side fixture; this does not establish general adversarial resilience. selected synthetic mid/side and phase-inversion fixtures ($W_L = \frac{M+S}{\sqrt{2}}, W_R = \frac{M-S}{\sqrt{2}}$).
* **Selected transcode fixture:** Passed a local fixture; it does not establish universal recovery. Reported $100\%$ confidence and $0.00$ BER through complex re-encoding chains (WAV &rarr; MP3 128k &rarr; AAC 96k &rarr; MP4 &rarr; MP3 64k &rarr; Opus 96k &rarr; WAV).
* **Analog Speed & Pitch Drift ($\pm1.0\%$):** Selected local resampling fixtures passed; this does not guarantee recovery with arbitrary analog wow/flutter or other speed changes.
* **Short crop fixture:** A 1.8-second local synthetic crop passed; recovery at other durations or on other audio is not guaranteed.
* **Multiple distinct keys:** Several local synthetic layered-watermark fixtures passed. This does not establish general multi-tenant coexistence for arbitrary files or repeated processing.

### Operational Boundaries
* **Extreme Low-Pass Filtering ($<4\text{ kHz}$):** Audio low-passed below 4 kHz (e.g. vintage telephone bandpass) strips all modulation bands.
* **Cryptographic Signatures:** Payloads are unsigned uint32 integers with CRC-16 integrity. (Cryptographic PKI digital signatures over metadata are scheduled for future revisions).
* **Same-key re-embedding:** Re-embedding with a conflicting ID is not reliably recoverable; this should be treated as a limitation, not a tamper-protection feature.

---

## 6. Commercial Model

* **Free for Personal / Non-Commercial Use:** Available under the PolyForm Noncommercial License 1.0.0.
* **Commercial Enterprise License:** Required for commercial software integrations, studio label mastering pipelines, and monetization platforms.
