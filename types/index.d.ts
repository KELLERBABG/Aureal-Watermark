/**
 * Type declarations for Aureal Watermark.
 * Acoustic steganography, digital provenance, and anti-theft audio watermarking.
 *
 * These declarations describe the runtime implementation behind the package
 * entry point (`src/index.js`); the exported value surface below is exactly the
 * set of bindings re-exported there.
 */

/* ====================================================================== *
 * Containers & bands
 * ====================================================================== */

export interface AudioFormat {
  /**
   * Sample rate in Hz (e.g. 44100, 48000, 96000).
   *
   * The watermark API (`embedWatermark` / `detectWatermark`, via `validateFmt`)
   * requires an integer between 8,000 and 768,000. `parseWav` accepts any
   * integer rate up to 768,000 and `writeWav` only requires a positive integer.
   */
  sampleRate: number;
  /**
   * Number of interleaved channels.
   *
   * The watermark API accepts **1 to 8** channels (`validateFmt`). `parseWav`
   * itself parses WAV files with **1 to 64** channels and `writeWav` only
   * requires >= 1, so audio read from disk can exceed the limit the watermark
   * functions accept.
   */
  channels: number;
  /**
   * Bit depth used by `writeWav` / `writeWavFile`: 16 or 24 write integer PCM,
   * 32 writes 32-bit IEEE float. Default: 16. Ignored by the watermark API.
   */
  bitDepth?: 16 | 24 | 32;
}

/** Format label reported by `parseWav`. */
export type ParsedWavFormat =
  | "PCM 8-bit"
  | "PCM 16-bit"
  | "PCM 24-bit"
  | "PCM 32-bit"
  | "IEEE float 32-bit";

export interface ParsedWav {
  sampleRate: number;
  channels: number;
  /** Always one of 8, 16, 24 or 32 for the formats `parseWav` accepts. */
  bitsPerSample: 8 | 16 | 24 | 32;
  numFrames: number;
  durationSec: number;
  /** Interleaved samples in [-1.0, 1.0]. */
  samples: Float32Array;
  format: ParsedWavFormat;
}

export type BandPresetName = "high" | "mid" | "dual" | "auto";

export interface CustomBand {
  lowHz: number;
  highHz: number;
  /**
   * Optional carrier centre frequency. Bands emitted by the engine always carry
   * a resolved centre (`(lowHz + highHz) / 2`), so this is set on every band
   * found in `WatermarkMetadata.bands` / detection results.
   */
  centerHz?: number;
}

/**
 * Band selection accepted by the watermark API.
 *
 * - `"high"` (17.0–19.5 kHz) and `"mid"` (4.5–13.5 kHz) select a single carrier
 *   band, or one wide band fitted to the available spectrum when the preset
 *   cannot fit under Nyquist (low sample rates).
 * - `"dual"`, `"auto"` and `undefined` build every preset that fits: both at
 *   normal rates, one at low rates, or a single fallback band when neither
 *   preset fits.
 * - A custom `{ lowHz, highHz }` object selects exactly that band and is
 *   rejected with a `RangeError` when it is not at least 200 Hz wide or does
 *   not fit below Nyquist.
 */
export type BandSpec = BandPresetName | CustomBand;

/* ====================================================================== *
 * Watermark options & results
 * ====================================================================== */

export interface WatermarkOptions {
  /** 32-bit unsigned integer ID to embed (0 to 4,294,967,295). */
  payloadId: number;
  /**
   * Obfuscation-grade PRNG seed for the spread-spectrum carrier — **not** a
   * cryptographic passkey. `src/signal.js` derives every chip and sync chirp
   * from an FNV-1a string hash feeding a xorshift128 generator, so the key hides
   * the carrier from casual inspection and keys detection, but it provides no
   * confidentiality, authentication, or cryptographic protection.
   * Default: the fixed internal key.
   */
  key?: string;
  /**
   * Watermark amplitude factor, clamped by the engine to [0.01, 1.0].
   * It scales the internal peak amplitude (0.0085, times 0.85 for the dual-band
   * carrier). Default: 0.5.
   */
  strength?: number;
  /**
   * Carrier band specification. `"high"` / `"mid"` build one band, `"dual"` /
   * `"auto"` (and omitting the option) build every preset that fits, and a
   * custom `{ lowHz, highHz }` object builds exactly that band. Default: "dual".
   */
  band?: BandSpec;
}

/** Frame geometry derived from sample rate and audio length. */
export interface WatermarkGeometry {
  /** Samples per codeword slot. */
  slotLen: number;
  /** Samples per PN chip inside a slot. */
  chipLen: number;
  /** Samples per repeated frame (`slotLen * bits`). */
  frameLen: number;
  /** Number of complete frames that fit in the input (`frameLen * reps` samples). */
  reps: number;
  /** Codeword length in symbols (48). */
  bits: number;
}

/**
 * Metadata attached to the audio buffer returned by `embedWatermark`, as the
 * non-enumerable `watermarkMeta` property of that same `Float32Array`.
 */
export interface WatermarkMetadata {
  /** Payload ID actually embedded (normalised with `>>> 0`). */
  payloadId: number;
  /** Key actually used (the internal default when `opts.key` was omitted). */
  key: string;
  /** Strength after clamping to [0.01, 1.0]. */
  strength: number;
  /**
   * Absolute peak watermark amplitude factor applied to the synthesized frame
   * (scaled by `MID_BAND_PERCEPTUAL_WEIGHT` for the mid band, `MULTI_BAND_SCALE`
   * for the dual carrier). Not a ratio of host level.
   */
  amplitude: number;
  /** Largest absolute watermark sample added before per-slot masking. */
  peakWatermark: number;
  /** `"dual"` when the carrier used both preset bands, otherwise the single resolved band. */
  band: CustomBand | "dual";
  /** Every resolved band the carrier was built from (1 or 2 entries). */
  bands: CustomBand[];
  geometry: WatermarkGeometry;
}

export interface DetectOptions {
  /**
   * Obfuscation-grade PRNG seed used during embedding — **not** a cryptographic
   * passkey. A wrong key yields noise rather than an authentication failure.
   * Default: the fixed internal key.
   */
  key?: string;
  /** Expected 32-bit uint ID to verify. If omitted, blind detection with CRC recovery is performed. */
  payloadId?: number;
  /**
   * Band to inspect. `"high"` / `"mid"` inspect one band, a custom
   * `{ lowHz, highHz }` object inspects exactly that band, and `"dual"` /
   * `"auto"` (the default) inspect every preset band that fits.
   */
  band?: BandSpec;
  /**
   * Retry at the canonical 44.1 kHz / 48 kHz rates with a band-limited sinc
   * resampler when native detection fails. Enabled unless explicitly `false`.
   */
  resample?: boolean;
  /**
   * Retry with small speed / pitch-drift resampling factors
   * (±0.2 %, ±0.5 %, ±1 %) when native detection fails. Enabled unless
   * explicitly `false`.
   */
  drift?: boolean;
}

export type DetectionMode = "verify" | "blind";
export type SyncMethod = "preamble" | "fractional_grid";

export interface DetectionDetails {
  /** `"verify"` when `payloadId` was supplied, `"blind"` otherwise. */
  mode: DetectionMode;
  /** Matched-filter z-score of the soft symbols against the reference codeword. */
  z: number;
  /** Eb/N0 of the winning hypothesis in decibels. */
  ebN0Db: number;
  /** Eb/N0 scaled by the repetition count, in decibels. */
  sqnrDb: number;
  /** `mu`: mean soft symbol after aligning against the reference codeword. */
  meanAlignedAmplitude: number;
  /** `sd`: spread of the aligned soft symbols. */
  amplitudeSpread: number;
  /** Codeword bit indices flipped by the CRC-guided correction sweep, or null. */
  bitsCorrected: number[] | null;
  /** The single flipped bit index when exactly one bit was corrected, else null. */
  singleBitCorrected: number | null;
  /**
   * Band selector echoed back: `opts.band` (possibly `undefined`) when more than
   * one band was tried, or the winning band when a single band was tried.
   */
  band: BandSpec | undefined;
  /** Resolved band the winning hypothesis was scored against. */
  bandUsed: CustomBand | null;
  /**
   * Number of frequency bands actually tried: 2 when both presets fit, 1 for a
   * single preset, a custom band, a low sample rate, or the fallback band.
   */
  bandsTried: number;
  /** Frame-fold offset, in samples, that produced the winning hypothesis. */
  resyncShiftSamples: number;
  syncMethod: SyncMethod;
  sampleRate: number;
  channels: number;
  perChannelSamples: number;
  /** Codeword length in symbols (48). */
  bits: number;
  /** Per-symbol soft correlations (48 values), or null when unavailable. */
  softSymbols: number[] | null;
  /** Present only on results promoted by the sample-rate resampling fallback. */
  resampled?: boolean;
  /** Source sample rate when the resampling fallback produced this result. */
  originalSampleRate?: number;
  /** Sample rate the winning resampling fallback ran at. */
  normalizedSampleRate?: number;
  /** Present only on results promoted by the speed / pitch-drift fallback. */
  driftFactor?: number;
}

export interface DetectionResult {
  /** Whether a CRC-valid watermark matching the key (and ID, in verify mode) was detected. */
  detected: boolean;
  /** Confidence score normalised to 0.0–1.0 from the z-score; detection needs >= 0.5 (0.35 with a passing CRC). */
  confidence: number;
  /**
   * Bit Error Rate between the hard symbol decisions and the reference codeword,
   * in 0.0–1.0.
   *
   * Only meaningful in verify mode (when `payloadId` was supplied). In blind
   * mode the hard decisions are compared against themselves, so `ber` is always
   * 0 regardless of detection quality — use `confidence`, `crcOk` and `z` there.
   */
  ber: number;
  /** Energy-per-bit to noise power spectral density ratio in decibels. */
  ebN0Db: number;
  /** Signal to quantization-noise ratio (Eb/N0 scaled by repetitions) in decibels. */
  sqnrDb: number;
  /** The 32-bit payload ID carried by the recovered codeword, or null when the CRC failed. */
  recoveredPayloadId: number | null;
  /** Whether the recovered codeword's CRC-16 matched. */
  crcOk: boolean;
  /** Number of complete watermark frames that were folded together. */
  reps: number;
  /** `mu`: mean aligned watermark amplitude recovered from the audio. */
  amplitude: number;
  /** Present only on results promoted by the sample-rate resampling fallback. */
  resampled?: boolean;
  /** Source sample rate when the resampling fallback produced this result. */
  originalSampleRate?: number;
  /** Sample rate the winning resampling fallback ran at. */
  normalizedSampleRate?: number;
  /** Present only on results promoted by the speed / pitch-drift fallback. */
  driftFactor?: number;
  /** Diagnostic matching metadata. */
  details: DetectionDetails;
}

/* ====================================================================== *
 * Licensing
 * ====================================================================== */

/** Tier reported by `getLicenseStatus`. */
export type LicenseTier = "commercial_pro" | "community_noncommercial";

/**
 * Record persisted in `~/.aureal/license.json` (the raw license key itself is
 * stripped before writing). Extra fields are preserved verbatim.
 */
export interface LocalLicenseRecord {
  displayKey?: string;
  status?: string;
  customerEmail?: string | null;
  customerName?: string | null;
  benefitId?: string | null;
  activatedAt?: string;
  expiresAt?: string | null;
  deviceLabel?: string;
  organizationId?: string;
  [field: string]: unknown;
}

export interface LicenseStatus {
  /** True when a cached, non-expired commercial license record exists. */
  isLicensed: boolean;
  tier: LicenseTier;
  tierLabel: string;
  /** Customer e-mail or name from the cached record, or null when unlicensed. */
  customer: string | null;
  /** Masked license key for display, or null when unlicensed. */
  displayKey: string | null;
  /** ISO timestamp stored at activation, or null when unlicensed. */
  activatedAt: string | null;
  /** ISO expiry from Polar, the literal "Perpetual / No Expiry", or null when unlicensed. */
  expiresAt: string | null;
}

export interface PolarValidationResult {
  valid: boolean;
  /** Raw Polar customer-portal response body when valid. */
  data?: Record<string, unknown>;
  error?: string;
}

export interface PolarActivationResult {
  success: boolean;
  /** License record that was cached locally when the activation succeeded. */
  license?: LocalLicenseRecord;
  error?: string;
}

/* ====================================================================== *
 * Embedding / detection
 * ====================================================================== */

/** `Float32Array` returned by `embedWatermark`, carrying its embed metadata. */
export interface EmbeddedAudio extends Float32Array {
  watermarkMeta: WatermarkMetadata;
}

/**
 * Embeds an imperceptible spread-spectrum watermark carrying a 32-bit ID into audio.
 *
 * @param samples Interleaved Float32Array audio samples in [-1.0, 1.0].
 * @param fmt Audio format containing sampleRate and channels (1–8).
 * @param params Options: payloadId, key, strength, band.
 * @throws TypeError When `params.payloadId` is missing / not an integer, or out of 32-bit range.
 * @throws RangeError When the format is unsupported, a custom band is too narrow to fit under
 *                    Nyquist, or the audio is shorter than one frame.
 */
export function embedWatermark(
  samples: Float32Array,
  fmt: AudioFormat,
  params: WatermarkOptions
): EmbeddedAudio;

/**
 * Detects and extracts an embedded watermark from audio samples.
 *
 * @param samples Interleaved Float32Array audio samples in [-1.0, 1.0].
 * @param fmt Audio format containing sampleRate and channels (1–8).
 * @param opts Detection options: key, payloadId (for verify mode), band, resample, drift.
 * @throws TypeError When `opts.payloadId` is supplied but is not a valid 32-bit uint, or a
 *                   custom band object lacks numeric `lowHz` / `highHz`.
 * @throws RangeError When the format is unsupported, a custom band does not fit under
 *                    Nyquist, or the audio is too short to score.
 */
export function detectWatermark(
  samples: Float32Array,
  fmt: AudioFormat,
  opts?: DetectOptions
): DetectionResult;

/* ====================================================================== *
 * WAV I/O
 * ====================================================================== */

/**
 * Parses uncompressed RIFF/WAVE PCM audio from an in-memory buffer.
 *
 * @param bytes Raw byte buffer of a WAV file (8/16/24/32-bit integer PCM or 32-bit IEEE float,
 *              1–64 channels).
 * @throws WavError When the buffer is not a supported, complete RIFF/WAVE image.
 */
export function parseWav(bytes: Uint8Array): ParsedWav;

/**
 * Encodes interleaved samples into a canonical 44-byte-header RIFF/WAVE buffer.
 *
 * @param samples Interleaved samples in [-1.0, 1.0] (`Float32Array` or a plain number array).
 * @param fmt Target format containing sampleRate, channels, and optional bitDepth
 *            (16 or 24 = integer PCM, 32 = IEEE float; default 16).
 * @returns A Node.js `Buffer` (an instance of `Uint8Array`).
 * @throws WavError On an unsupported bit depth, a bad channel count / sample rate,
 *                  or a sample count that is not a multiple of the channel count.
 */
export function writeWav(
  samples: Float32Array | number[],
  fmt: AudioFormat
): Uint8Array;

/**
 * Reads and parses a WAV file from disk.
 *
 * @param path File system path to the input WAV file.
 */
export function readWavFile(path: string): Promise<ParsedWav>;

/**
 * Writes PCM audio samples to disk as a standard RIFF/WAVE file.
 *
 * @param path File system path to write to.
 * @param samples Interleaved samples in [-1.0, 1.0] (`Float32Array` or a plain number array).
 * @param fmt Format options: sampleRate, channels, bitDepth (default: 16).
 */
export function writeWavFile(
  path: string,
  samples: Float32Array | number[],
  fmt: AudioFormat
): Promise<void>;

/** Thrown by `parseWav` / `writeWav` on malformed or unsupported WAVE data. */
export class WavError extends Error {}

/* ====================================================================== *
 * Synthesis
 * ====================================================================== */

/**
 * Generates synthetic speech-like harmonic test audio for benchmarks and demos.
 *
 * @param opts.seconds Duration in seconds (clamped to >= 0.1). Default: 10.
 * @param opts.sampleRate Sample rate in Hz. Default: 44100.
 * @param opts.channels Channel count, clamped to 1–8. Default: 1.
 * @param opts.seed Deterministic seed (stringified before hashing). Default: "seed".
 * @param opts.peak Peak amplitude, clamped to 0.05–0.95. Default: 0.5.
 * @returns Interleaved Float32 samples.
 */
export function synthesizeSpeechLike(opts?: {
  seconds?: number;
  sampleRate?: number;
  channels?: number;
  seed?: string | number;
  peak?: number;
}): Float32Array;

/* ====================================================================== *
 * Payload codeword
 * ====================================================================== */

/**
 * Computes CRC-16/CCITT-FALSE over a byte sequence.
 *
 * The payload CRC is computed over the four big-endian bytes of the payload ID.
 * Note that a number is not a byte sequence: passing a number yields 0xFFFF
 * because the loop never runs.
 *
 * @param bytes Bytes to checksum (array, typed array, or `Buffer`).
 * @returns Unsigned 16-bit checksum.
 */
export function crc16(bytes: ArrayLike<number>): number;

/**
 * Packs a 32-bit integer ID into a 48-symbol BPSK codeword (+1/-1) with 16-bit CRC.
 *
 * @throws TypeError When `id` is not an integer in [0, 2^32-1].
 */
export function packCodeword(id: number): Int8Array;

/**
 * Decodes a 48-symbol BPSK codeword back to its 32-bit ID and checks the CRC.
 *
 * The returned `id` is the payload carried by the 32 data symbols (`>>> 0`);
 * `crcOk` reports whether the 16 CRC symbols match those payload bytes.
 *
 * @param symbols Exactly 48 symbols; a symbol is read as bit 1 when `> 0`.
 * @throws RangeError When the codeword length is not 48.
 */
export function unpackCodeword(symbols: ArrayLike<number>): {
  id: number;
  crcOk: boolean;
};

/**
 * Verifies if a number is a valid 32-bit unsigned integer ID.
 */
export function isValidPayloadId(id: unknown): id is number;

/* ====================================================================== *
 * Engine constants
 * ====================================================================== */

/** Frozen default band: 17,000–19,500 Hz with an 18,250 Hz centre. */
export const DEFAULT_BAND: Readonly<{ lowHz: number; highHz: number; centerHz: number }>;

/** Symbols per codeword: 32 payload bits + 16 CRC bits = 48. */
export const BITS_PER_CODEWORD: number;

/** Polar.sh organization ID used for license validation and activation. */
export const POLAR_ORGANIZATION_ID: string;

/* ====================================================================== *
 * License management
 * ====================================================================== */

/**
 * Validates a commercial Polar.sh license key without activating a new machine seat.
 * Only the key string is sent to Polar; no audio data leaves the machine.
 */
export function validatePolarKey(key: string): Promise<PolarValidationResult>;

/**
 * Activates a commercial Polar.sh license key and caches credentials locally.
 *
 * @param key License key.
 * @param label Optional device label; defaults to `<hostname> (<platform> <arch>)`.
 */
export function activatePolarKey(key: string, label?: string): Promise<PolarActivationResult>;

/**
 * Loads the cached license record from disk, or null when absent, expired or invalid.
 */
export function loadLocalLicense(): LocalLicenseRecord | null;

/**
 * Saves a license record to the local offline cache.
 * The raw `key` field is stripped before the record is written, and write
 * failures only emit a warning — nothing is thrown and nothing is returned.
 */
export function saveLocalLicense(record: LocalLicenseRecord): void;

/**
 * Deletes the local license cache.
 *
 * @returns true when the file is gone, false when deletion failed.
 */
export function clearLocalLicense(): boolean;

/**
 * Checks if the current machine has an active cached commercial license.
 */
export function getLicenseStatus(): LicenseStatus;

/**
 * Obfuscates sensitive characters of a license key string for display.
 * Keys of eight characters or fewer become `****`; longer keys become
 * `****-<last eight characters>`.
 */
export function maskKey(key: string): string;

/* ====================================================================== *
 * Forensic reporting
 * ====================================================================== */

export interface ForensicReportOptions {
  /** Result returned by `detectWatermark`. */
  detectionResult: DetectionResult;
  /** Raw bytes of the analysed file (Node `Buffer` or `Uint8Array`). */
  audioBytes: Uint8Array;
  /** Optional audio properties; missing fields fall back to null / "unknown". */
  audioMetadata?: {
    durationSec?: number;
    sampleRate?: number;
    channels?: number;
    format?: string;
  };
  /** Path recorded for the analysed file. Default: "input.wav". */
  filePath?: string;
  /** Expected payload ID to compare against the recovered ID. Default: null. */
  expectedPayloadId?: number | null;
  /**
   * Shared secret used for the HMAC-SHA256 seal. Default: a public, deterministic
   * key, so production users should supply and protect their own secret.
   */
  secret?: string;
}

/** Verdict recorded in `ForensicReport.verification.status`. */
export type ForensicStatus =
  | "WATERMARK_ID_MATCH"
  | "WATERMARK_DETECTED"
  | "PAYLOAD_MISMATCH"
  | "DETECTION_UNCERTAIN"
  | "NO_WATERMARK_FOUND";

export interface ForensicReport {
  schemaVersion: string;
  generatedAt: string;
  engine: {
    name: string;
    version: string;
  };
  targetFile: {
    path: string;
    sizeBytes: number;
    hashes: {
      sha256: string;
      sha512: string;
    };
  };
  audioProperties: {
    durationSec: number | null;
    sampleRate: number | null;
    channels: number | null;
    format: string;
  };
  verification: {
    status: ForensicStatus;
    detected: boolean;
    recoveredPayloadId: number | null;
    expectedPayloadId: number | null;
    /** null when no `expectedPayloadId` was supplied or nothing was detected. */
    payloadMatch: boolean | null;
    confidence: number;
    ber: number;
    crcOk: boolean;
  };
  forensicMetrics: {
    ebN0Db: number | null;
    sqnrDb: number | null;
    zScore: number | null;
    repsDetected: number | null;
    carrierBand: { lowHz: number; highHz: number; centerHz: number } | null;
    syncMethod: string;
    resyncShiftSamples: number;
  };
  interpretation: {
    note: string;
    methodology: string;
  };
  /** Shared-secret HMAC-SHA256 seal over the whole report body (not a public-key signature). */
  signature: {
    algorithm: string;
    canonicalization: string;
    covers: string;
    seal: string;
  };
}

/** Outcome of `verifyForensicReport`. */
export interface ForensicVerificationResult {
  valid: boolean;
  reason: string;
  /** First 16 hex characters of the expected seal (only set once a seal was found). */
  expected?: string;
  /** First 16 hex characters of the seal carried by the report. */
  actual?: string;
}

export const REPORT_SCHEMA_VERSION: string;
export const ENGINE_NAME: string;
export const ENGINE_VERSION: string;

/**
 * Generates a detection audit report with file hashes and a shared-key HMAC seal.
 * The report does not establish authorship, identity, or chain of custody.
 *
 * @throws Error When `detectionResult` is missing.
 */
export function generateForensicReport(options: ForensicReportOptions): ForensicReport;

/**
 * Verifies the HMAC seal of a report produced by `generateForensicReport`.
 * Malformed input (missing seal, unknown canonicalisation, tampered body) is
 * reported as `{ valid: false, reason }` rather than thrown; only a report with
 * circular references can make the canonicalisation step throw.
 *
 * @param report Report object (e.g. parsed from JSON).
 * @param opts.secret Shared secret; must match the one used to generate the report.
 */
export function verifyForensicReport(
  report: ForensicReport | Record<string, unknown> | null | undefined,
  opts?: { secret?: string }
): ForensicVerificationResult;

/**
 * Canonical JSON of a report body (everything except `signature`), with keys
 * sorted recursively and `undefined` values dropped.
 */
export function canonicalReportBody(
  report: ForensicReport | Record<string, unknown> | null | undefined
): string;

/**
 * Formats a detection audit report into human-readable text.
 */
export function formatForensicReportText(report: ForensicReport): string;

/* ====================================================================== *
 * Tardos collusion scoring
 * ====================================================================== */

export interface TardosCodebookOptions {
  /** Number of recipients to generate codewords for. Default: 10. */
  numRecipients?: number;
  /** Symbols per codeword (m). Default: 48, matching one audio frame. */
  codeLength?: number;
  /** Expected maximum coalition size c; sets the bias cutoff. Default: 4. */
  maxCoalition?: number;
  /** Deterministic master key for the bias/codeword PRNG. Default: "tardos-default-key". */
  seedKey?: string;
}

export interface TardosCodebook {
  /** Bias vector: one sampling probability per symbol, all within [cutoff, 1 - cutoff]. */
  biases: number[];
  /** Bias cutoff `t` (= 1 / (300 * maxCoalition), clamped to [0.01, 0.25]). */
  cutoff: number;
  /** Number of symbols per codeword. */
  codeLength: number;
  /** One ±1 codeword per recipient, in generation order. */
  codebook: Int8Array[];
}

export interface TardosRecipient {
  /** Identifier copied verbatim into the accusation scores. */
  id: number | string;
  /** Display name copied verbatim into the accusation scores. */
  name: string;
  /** ±1 symbols aligned with the bias vector (at least the scored length). */
  codeword: ArrayLike<number>;
}

export interface AccusationScore {
  id: number | string;
  name: string;
  /** Raw symmetric Tardos score. */
  score: number;
  /** `score / sqrt(m)`. */
  normalizedScore: number;
}

export interface AccusationReport {
  /** Recipients at or above the accusation threshold, highest score first. */
  accused: AccusationScore[];
  /** True when more than one recipient is accused. */
  isCollusion: boolean;
  /** Highest-scoring recipient, or null when no recipients were scored. */
  topSuspect: AccusationScore | null;
  /** max(1.4 * sqrt(m), median + 1.8 * robustStdDev). */
  threshold: number;
  /** Median of all recipient scores. */
  medianScore: number;
  /** Median-absolute-deviation based standard deviation estimate. */
  robustStdDev: number;
  /** Every recipient, sorted by descending score. */
  rankedScores: AccusationScore[];
}

/**
 * Generates a Tardos fingerprint codebook for a list of recipients.
 *
 * This is the scoring half of the code only: `embedWatermark` never embeds a
 * Tardos codeword, so collusion resistance requires a separate signalling
 * channel that carries per-recipient codewords.
 */
export function generateTardosCodebook(opts?: TardosCodebookOptions): TardosCodebook;

/**
 * Scores recipients against recovered soft symbol correlations and accuses the
 * highest ones.
 *
 * @param softSymbols Extracted soft correlation per symbol.
 * @param recipients Recipient list with per-recipient codewords.
 * @param biases Bias vector from `generateTardosCodebook`.
 * @returns Ranking, threshold and accused coalition.
 */
export function accuseCoalition(
  softSymbols: ArrayLike<number>,
  recipients: TardosRecipient[],
  biases: ArrayLike<number>
): AccusationReport;
