# Aureal Watermark Whitepaper

**Version:** 0.2.4 &bull; **Status:** Production-Ready DSP Core & Universal Application Bundle

> An inaudible spread-spectrum steganographic audio watermark proving that an audio recording originates from a verified human creator or official source. Verifiable in seconds, client-side in the browser, with zero server infrastructure.

---

## 1. Abstract

With the proliferation of realistic voice-cloning models, deepfake audio and unauthorized voice scraping have become significant legal and commercial liabilities. High-profile podcast hosts, voice actors, musicians, and executives frequently find their voices cloned or leaked without consent. While regulatory frameworks like the EU AI Act mandate provenance transparency for synthetic media, the industry lacks an accessible, client-side verification tool to prove the inverse: **This audio is an authentic, registered human production.**

Aureal Watermark embeds a 32-bit provenance tracking identifier directly into the audio waveform during recording, mastering, or distribution. The signal is modulated as a Direct-Sequence Spread Spectrum (DSSS) carrier across strictly near-ultrasonic bands (17.0–19.5 kHz) and A-weighted speech-masked mid-bands (8–13 kHz). The payload is protected by a CRC-16 checksum, supports 2-bit reliability-ordered error correction, repeats coherently across the full track duration, and remains invariant to volume/gain shifts.

Tested across multi-generation `ffmpeg` encoding round-trips, the watermark survives MP3 (128 kbps / 320 kbps) and AAC (128 kbps) re-encoding while correctly rejecting unregistered or mismatched IDs.

---

## 2. Problem & Market

| Industry Reality | Market Consequence |
| :--- | :--- |
| **Voice cloning takes minutes instead of weeks** | Verifiable authenticity becomes a primary commercial asset for human productions. |
| **EU AI Act & Global Regulatory Mandates** | Broadcasters, studios, and publishers require verifiable provenance documentation. |
| **Existing watermarking research is locked in proprietary labs** | Creators lack an instant, zero-dependency, 1-click offline attribution tool. |

**Primary Buyers:** Podcast networks, radio broadcasters, record labels, legal evidence archives, and voice talent agencies.
**Cost Structure:** Zero server overhead. Embedding happens locally in the export pipeline; detection runs client-side in browser memory.

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

**Deployment Profiles:**

| Mode | Carrier Band | Characteristics |
| :--- | :--- | :--- |
| `high` | 17.0–19.5 kHz | Maximum psychoacoustic stealth; strictly inaudible near-ultrasound; high-bitrate & lossless. |
| `mid` | 8.0–13.0 kHz | Survives lossy compression low-pass filters; A-weighted for transparent masking. |
| `dual` | Both bands | Redundant simultaneous embedding across both bands; detector automatically falls back to best band. |

In `dual` mode, the embedder scales each copy by $\times 0.7$ with A-weighted attenuation on the mid band to maintain complete psychoacoustic transparency ($-51\text{--}-55\text{ dBFS}$ nominal level).

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

Automated test suite (42 tests via `node --test`) including 11 `ffmpeg` lossy codec round-trips (synthetic & speech material, 20s, 44.1 kHz mono, strength 0.5):

| Carrier Band | MP3 128k | MP3 320k | AAC 128k | Additive Noise (−30 dBFS) | Gain Shift (0.5× / 2.0×) |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **High** | ✔ Detected | ✔ Detected | ✔ Detected | ✔ Detected | ✔ Detected |
| **Mid** | ✔ Detected | ✔ Detected | ✔ Detected | ✔ Detected | ✔ Detected |
| **Dual** | ✔ Detected | ✔ Detected | ✔ Detected | ✔ Detected | ✔ Detected |

* **Rejection Accuracy:** Unmarked audio, wrong secret keys, and mismatched expected IDs are rejected with $0.0\%$ confidence.
* **Blind Recovery:** Recovers embedded 32-bit payloads without prior ID knowledge via CRC-16 validation.
* **Clean-Path Fidelity:** $100\%$ confidence with $0.0\%$ Bit Error Rate on lossless passes.

---

## 5. Threat Model & Explicit Boundaries

### Verified Capabilities
* **Key-Bound Forensic Attribution:** Proves conclusively that a leaked recording originated from a specific master or was licensed to a specific recipient.
* **Adversarial Channel Resilience:** Survives Mid/Side vocal-remover subtraction ($L - R$) and anti-phase cancellations via unitary orthogonal mixing ($W_L = \frac{M+S}{\sqrt{2}}, W_R = \frac{M-S}{\sqrt{2}}$).
* **Multi-Generational Transcoding:** Retains $100\%$ confidence and $0.00$ BER through complex re-encoding chains (WAV &rarr; MP3 128k &rarr; AAC 96k &rarr; MP4 &rarr; MP3 64k &rarr; Opus 96k &rarr; WAV).
* **Analog Speed & Pitch Drift ($\pm1.0\%$):** Frequency rake receiver sweeps drift factors to lock carrier phase coherence after playback speed modifications.
* **Micro-Snippet Reconstruction (1.0s &ndash; 1.8s):** Circular modulo frame folding reconstructs complete codewords across unaligned cuts.
* **Multi-Tenant CDMA Coexistence:** Multiple studios can embed distinct watermarks on the same file with independent private keys; all coexist without destructive cross-talk.

### Operational Boundaries
* **Extreme Low-Pass Filtering ($<4\text{ kHz}$):** Audio low-passed below 4 kHz (e.g. vintage telephone bandpass) strips all modulation bands.
* **Cryptographic Signatures:** Payloads are unsigned uint32 integers with CRC-16 integrity. (Cryptographic PKI digital signatures over metadata are scheduled for future revisions).
* **Same-Key Overwriting:** Re-marking a file using the *same* private key with a conflicting ID causes destructive bit interference, intentionally preventing unauthorized tampering under an existing studio key.

---

## 6. Commercial Model

* **Free for Personal / Non-Commercial Use:** Available under the PolyForm Noncommercial License 1.0.0.
* **Commercial Enterprise License:** Required for commercial software integrations, studio label mastering pipelines, and monetization platforms.
