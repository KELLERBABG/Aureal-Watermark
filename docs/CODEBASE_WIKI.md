# Aureal Watermark — Codebase Wiki

A comprehensive architectural and algorithmic reference for every file, module, function, and data structure in the Aureal Watermark repository.

---

## 1. Directory Structure

```
Aureal-Watermark/
├── bin/
│   └── auralwatermark.js           # CLI entry point (gen, embed, detect subcommands)
├── src/
│   ├── index.js                    # Public ESM package root
│   ├── signal.js                   # DSP primitives, PRNG, Hann cache, template builder
│   ├── payload.js                  # 32-bit ID + CRC-16 codeword packing & unpacking
│   ├── embed.js                    # Core watermark waveform injection pipeline
│   ├── detect.js                   # Matched filter, frame folding, resync, z-score engine
│   ├── wav.js                      # RIFF/WAVE parser & writer (8/16/24/32-bit int, float32)
│   ├── synth.js                    # Deterministic harmonic speech-like audio synthesizer
│   └── browser/
│       └── aural-watermark-verify.js # Browser-native AudioBuffer & DataView verifier
├── demo/
│   ├── index.html                  # Interactive Studio Web UI (Mirror)
│   └── verifier.html               # Dual-tab Embed & Verify Studio (Runs offline over file://)
├── docs/
│   ├── CODEBASE_WIKI.md            # (This file) Complete codebase reference
│   ├── WHITEPAPER.md               # Threat model, benchmark data, and formal specifications
│   ├── ARCHITECTURE.md             # High-level module architecture and data flow diagrams
│   ├── USAGE.md                    # Detailed CLI, API, and browser usage guide
│   └── PAYLOAD-FORMAT.md           # Bit-level wire format and mathematical constants
├── test/
│   ├── watermark.test.js           # Core DSP embedding & detection verification
│   ├── codec.test.js               # ffmpeg MP3 (128k/320k) and AAC (128k) round-trips
│   ├── cli.test.js                 # Command-line interface subprocess tests
│   ├── wav.test.js                 # WAV header parsing, round-trip, and error handling
│   └── browser.test.js             # Browser module execution tests
├── LICENSE.md                      # PolyForm Noncommercial 1.0.0 + Commercial License
├── package.json                    # Package metadata, exports, bin configuration
└── README.md                       # Main project documentation and quickstart
```

---

## 2. File-by-File Module Reference

---

### `bin/auralwatermark.js`
* **Role:** Command-line interface (CLI) driver.
* **Dependencies:** `src/embed.js`, `src/detect.js`, `src/wav.js`, `src/synth.js`, `node:process`, `node:util`.
* **Execution:** Executable via `node bin/auralwatermark.js` or `npx aureal-watermark`.

#### Subcommands:
1. `gen <output.wav> [--seconds N] [--rate R] [--channels C] [--bits 16|24]`
   * Generates a deterministic speech-like test audio file using `src/synth.js`.
2. `embed <input.wav> <output.wav> --id <uint32> [--key s] [--strength 0..1] [--band dual|high|mid]`
   * Reads `input.wav`, applies watermark via `embedWatermark`, and writes `output.wav`.
3. `detect <input.wav> [--id <uint32>] [--key s] [--band auto|dual|high|mid] [--json]`
   * Executes matched filter detection. Returns exit code `0` if verified, `1` if rejected/absent, `2` on error.
   * Outputs clean human-readable summaries or machine-readable JSON if `--json` is specified.

---

### `src/index.js`
* **Role:** Public module entry point for Node.js / ESM consumers.
* **Exports:**
  * `embedWatermark` from `./embed.js`
  * `detectWatermark` from `./detect.js`
  * `packCodeword`, `unpackCodeword`, `isValidPayloadId` from `./payload.js`
  * `readWavFile`, `writeWavFile`, `parseWav`, `writeWav` from `./wav.js`
  * `synthesizeSpeechLike` from `./synth.js`

---

### `src/signal.js`
* **Role:** Deterministic Digital Signal Processing (DSP) and pseudorandom generator primitives.
* **Key Functions & Constants:**
  * `hashSeed(str)`: Implements a 32-bit FNV-1a non-cryptographic string hash to derive repeatable 32-bit integers from secret key strings.
  * `makeRng(seed)`: Initializes a Marsaglia `xorshift128` pseudorandom generator. Produces uniform floating-point values in $[0.0, 1.0)$.
  * `makeSymbolStream(key, label)`: Returns a deterministic stream of $\pm 1$ pseudorandom symbols seeded by `key + "|" + label`.
  * `hannWindow(n)`: Computes and caches a Hann window ($w[i] = 0.5 - 0.5 \cos(2\pi i / n)$) of length $n$ to guarantee smooth burst boundaries with zero transients.
  * `BAND_PRESETS`:
    * `high`: $16.5\text{ kHz} - 19.5\text{ kHz}$ (Center: $18.0\text{ kHz}$)
    * `mid`: $8.0\text{ kHz} - 13.0\text{ kHz}$ (Center: $10.5\text{ kHz}$)
  * `deriveGeometry(sampleRate, perChannelSamples, opts)`:
    * Calculates slot length, chip length, frame length (~1.0s), and repetition count ($reps = \lfloor N / frameLen \rfloor$).
    * Ensures the embedder and detector construct bit-identical geometries.
  * `buildTemplate({ key, sampleRate, geometry, band })`:
    * Constructs the reference carrier template. For each of the 48 codeword slots, it modulates 24 Hann-windowed sinusoidal carrier bursts with the keyed PN chips.
    * Returns `{ template: Float64Array, slotNorms: Float64Array }`.

---

### `src/payload.js`
* **Role:** Bit-level codeword structure, error correction codes, and payload validation.
* **Key Functions & Constants:**
  * `PAYLOAD_BITS = 32`: Unsigned 32-bit integer payload ID ($0$ to $4,294,967,295$).
  * `CRC_BITS = 16`: 16-bit CRC checksum.
  * `BITS_PER_CODEWORD = 48`: Total symbol count ($32 + 16$).
  * `crc16(bytes)`: Computes standard CRC-16/CCITT-FALSE (polynomial `0x1021`, initial value `0xFFFF`, no reflection, XOR out `0x0000`) over the 4 big-endian payload bytes.
  * `packCodeword(payloadId)`:
    * Serializes a uint32 ID into 32 binary bits, calculates the 16-bit CRC, and returns an `Int8Array(48)` of $\pm 1$ BPSK symbols ($1 \to +1, 0 \to -1$).
  * `unpackCodeword(cw)`:
    * Converts 48 binary polarities back into uint32 ID and checks whether the received CRC matches the recalculated CRC. Returns `{ id, crcOk: boolean }`.
  * `hamming(a, b)`: Computes the bitwise Hamming distance between two 48-symbol arrays.

---

### `src/embed.js`
* **Role:** Watermark waveform injection and multi-band superposition.
* **Key Functions:**
  * `embedWatermark(pcm, fmt, opts)`:
    1. Validates audio format (`sampleRate`, `channels`, sample count).
    2. Resolves carrier bands (`dual`, `high`, `mid`, or custom).
    3. Derives frame geometry and constructs the 48-symbol BPSK codeword.
    4. Synthesizes the modulated spread-spectrum waveform by multiplying codeword polarities with the keyed PN template.
    5. Loops across all coherent 1-second repetitions and adds the watermark to each audio channel via floating-point superposition.
    6. Attaches non-enumerable metadata (`watermarkMeta`) and returns a new `Float32Array`.
  * `validateFmt(fmt, totalSamples)`: Validates that sample rates are within $8\text{ kHz} - 768\text{ kHz}$, channels are between $1 - 8$, and the buffer length divides evenly by channel count.

---

### `src/detect.js`
* **Role:** Matched filtering, coherent frame integration, resynchronization search, and statistical confidence computation.
* **Key Pipeline Steps:**
  1. `foldRepetitions(pcm, channels, frameLen, startOffset, usableSamples)`:
     * Folds all 1-second audio frames and sums across all channels into a single composite frame.
     * Cancels uncorrelated music/voice energy while coherently integrating the repeating watermark signal.
  2. `scoreHypothesis(pcm, fmt, { key, payloadId, sampleRate, band })`:
     * Evaluates fractional resync offsets across $\pm 1/16, \pm 2/16, \pm 4/16$ frame lengths to recover any sample shifts introduced by lossy encoders.
     * Computes the normalized inner product (matched filter) for each of the 48 slots:
       $$soft[b] = \frac{\langle folded_b, template_b \rangle}{reps \times channels \times \|template_b\|^2}$$
     * Performs hard thresholding ($soft[b] \ge 0 \implies +1$, else $-1$) and checks CRC-16.
     * **1-Bit Error Correction:** If CRC fails, it flips bits in ascending order of $|soft|$ magnitude until CRC passes.
     * Calculates the statistical $z$-score and maps it to a normalized confidence value $[0.0, 1.0]$.
  3. `detectWatermark(pcm, fmt, opts)`:
     * Evaluates hypotheses across candidate bands (or both bands in `auto` mode) and returns the winning detection result.

---

### `src/wav.js`
* **Role:** Lightweight, zero-dependency RIFF/WAVE container parser and serializer.
* **Capabilities:**
  * Supports 8-bit unsigned, 16-bit signed, 24-bit signed, 32-bit signed integer PCM, and 32-bit IEEE floating-point.
  * Handles standard `WAVE_FORMAT_PCM` and `WAVE_FORMAT_EXTENSIBLE` headers.
  * `parseWav(Uint8Array)`: Extracts sample rate, channels, bit depth, frame count, and interleaved `Float32Array` samples in $[-1.0, 1.0]$.
  * `writeWav(Float32Array, opts)`: Encodes samples into a 44-byte canonical WAV Buffer with 16-bit or 24-bit PCM depth.
  * `readWavFile(path)` / `writeWavFile(path, samples, opts)`: Asynchronous filesystem helpers for Node.js.

---

### `src/synth.js`
* **Role:** Deterministic speech-like test audio generator.
* **Mechanism:**
  * Synthesizes an acoustic test signal with an $F_0$ fundamental pitch (110–170 Hz), formant resonances ($F_1, F_2, F_3$), vibrato, syllabic amplitude envelope modulation, and low-passed breath noise.
  * Keeps energy concentrated below 11 kHz to provide clean synthetic audio for benchmarks without polluting the watermark carrier band.

---

### `src/browser/aural-watermark-verify.js`
* **Role:** Standalone client-side verification module for web browsers.
* **Capabilities:**
  * Contains zero Node.js imports (`fs`, `Buffer`, `process` are completely absent).
  * `verifyAudioBuffer(audioBuffer, expectedId, key, opts)`: Accepts any decoded Web Audio `AudioBuffer` (MP3, AAC, M4A, OGG, FLAC) and extracts PCM for detection.
  * `verifyWav(arrayBuffer, expectedId, key, opts)`: Synchronously parses raw WAV `ArrayBuffer`s via `DataView`.

---

### `demo/verifier.html` & `demo/index.html`
* **Role:** Interactive Web Studio & Offline Verification Application.
* **Architecture:**
  * 100% self-contained single-page application with inlined CSS, HTML5 Web Audio API decoding, and inlined DSP detection/embedding engines.
  * Runs directly over the `file://` protocol without CORS errors or local web servers.
  * **Verify Tab:** Drag-and-drop audio inspector with blind auto-extraction or targeted ID verification, returning Bit Error Rate, Confidence, and integrated frame diagnostics.
  * **Embed Tab:** In-browser watermark generator that blends carrier signals, previews the tagged audio in an HTML5 player, and exports 16-bit PCM WAV masters.

---

## 3. End-to-End Mathematical Data Flow

### The Embedding Flow

```
1. Input: uint32 Payload ID (e.g. 883921)
   │
   ▼
2. Codeword Construction:
   • 32-bit binary representation: 00000000 00001101 01111100 11001001
   • CRC-16 calculation: 0x9A4F (10011010 01001111)
   • 48 BPSK Symbols: [+1, -1, -1, +1, ...] (Int8Array)
   │
   ▼
3. Carrier Synthesis:
   • For each symbol slot (b = 0..47):
     - Generate 24 pseudo-random chips from seed `key|bit{b}`
     - Multiply chips by Hann-windowed sine wave (f_center = 18.0 kHz / 10.5 kHz)
     - Multiply slot by codeword symbol (+1 or -1)
   │
   ▼
4. Waveform Injection:
   • Scale by amplitude (strength * 0.12 * multiBandScale)
   • Add frame repeatedly across all track channels
   │
   ▼
5. Output: Tagged PCM Waveform (Float32Array)
```

---

### The Detection Flow

```
1. Input: Audio waveform (Float32Array) + Secret Key
   │
   ▼
2. Multi-Channel Frame Folding:
   • Sum samples across channels
   • Fold repeating ~1.0s frames into one composite frame (SNR increases with length)
   │
   ▼
3. Resynchronization Sweep:
   • Test fractional offsets [-4/16 .. +4/16] to align with lossy codec sample shifts
   │
   ▼
4. Matched Filter Dot-Product:
   • Multiply composite frame with bit-identical keyed carrier templates
   • Compute 48 soft-decision correlation values
   │
   ▼
5. Decoding & 1-Bit Error Correction:
   • Extract hard polarities (soft[b] >= 0)
   • Validate CRC-16 checksum
   • If invalid: Flip least-reliable bits until CRC passes
   │
   ▼
6. Statistical Confidence & Verdict:
   • Compute z-score of aligned amplitude against variance
   • Map to confidence in [0.0, 1.0]
   • Return: { detected: boolean, confidence, ber, recoveredPayloadId }
```
