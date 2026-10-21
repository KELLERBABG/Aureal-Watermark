/**
 * Type declarations for Aureal Watermark.
 * Acoustic steganography, digital provenance, and anti-theft audio watermarking.
 *
 * These declarations mirror the runtime surface exported by `src/index.js`.
 */

export interface AudioFormat {
  /** Sample rate in Hz (e.g. 44100, 48000, 96000). Must be an integer between 8,000 and 768,000. */
  sampleRate: number;
  /** Number of interleaved channels (1 to 8). */
  channels: number;
  /**
   * Integer PCM word depth written by `writeWav` (16, 24 or 32) or 32 for
   * 32-bit IEEE float. Defaults to 16 for `writeWavFile` / server output.
   * Ignored by `embedWatermark` / `detectWatermark`, which always operate on
   * normalized float samples.
   */
  bitDepth?: 16 | 24 | 32;
}

export interface ParsedWav {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  numFrames: number;
  durationSec: number;
  /** De-interleaved float samples in [-1.0, 1.0], length = numFrames * channels. */
  samples: Float32Array;
  format: "pcm" | "float";
}

/** Named presets: `high` = 17.0-19.5 kHz, `mid` = 4.5-13.5 kHz, `dual` = both. */
export type BandPresetName = "high" | "mid" | "dual" | "auto";

export interface CustomBand {
  lowHz: number;
  highHz: number;
  centerHz?: number;
}

/**
 * Band selector accepted by the engine:
 * a preset name, an explicit `{ lowHz, highHz }` object, or a
 * `"lowHz:highHz"` / `"lowHz-highHz"` string.
 */
export type BandSpec = BandPresetName | CustomBand | `${number}:${number}` | `${number}-${number}`;

export interface Band {
  lowHz: number;
  highHz: number;
  centerHz: number;
}

export interface WatermarkOptions {
  /** 32-bit unsigned integer ID to embed (0 to 4,294,967,295). Required. */
  payloadId: number;
  /** Passkey used to seed the pseudo-random carrier sequence. Default: internal key. */
  key?: string;
  /** Watermark amplitude strength factor between 0.01 and 1.0. Default: 0.5. */
  strength?: number;
  /** Frequency band specification ("dual", "high", "mid", or a custom band). Default: "dual". */
  band?: BandSpec;
}

export interface WatermarkGeometry {
  slotLen: number;
  frameLen: number;
  reps: number;
  bits: number;
}

export interface WatermarkMetadata {
  key: string;
  payloadId: number;
  strength: number;
  /** Resolved carrier bands that were modulated. */
  bands: Band[];
  band: Band | "dual";
  peakWatermark: number;
  sampleRate: number;
  channels: number;
  geometry: WatermarkGeometry;
}

export interface DetectOptions {
  /** Passkey used during embedding. */
  key?: string;
  /** Expected 32-bit uint ID to verify. If omitted, blind detection with CRC recovery is performed. */
  payloadId?: number;
  /** Band to inspect ("auto", "dual", "high", "mid", or a custom band). Default: "auto". */
  band?: BandSpec;
  /** Set to false to disable the 44.1/48 kHz re-sampling retry sweep. Default: true. */
  resample?: boolean;
  /** Set to false to disable the micro pitch-drift retry sweep. Default: true. */
  drift?: boolean;
}

export interface DetectionDetails {
  mode: "verify" | "blind";
  /** Z-score of the aligned soft correlation. */
  z: number;
  ebN0Db: number;
  sqnrDb: number;
  meanAlignedAmplitude: number;
  amplitudeSpread: number;
  /** Symbol indices repaired by the single/dual-bit CRC sweep, or null. */
  bitsCorrected: number[] | null;
  singleBitCorrected: number | null;
  /** Band selector that was requested (or the winning band when only one was tried). */
  band: BandSpec | Band | null;
  bandUsed: Band | null;
  bandsTried: number;
  resyncShiftSamples: number;
  syncMethod: "preamble" | "fractional_grid" | string;
  sampleRate: number;
  channels: number;
  perChannelSamples: number;
  bits: number;
  /** Per-symbol soft correlations in [-1, 1]; used by Tardos accusation. */
  softSymbols: number[] | null;
  driftFactor?: number;
  resampled?: boolean;
  originalSampleRate?: number;
  normalizedSampleRate?: number;
}

export interface DetectionResult {
  /** Whether a valid watermark matching the key and CRC/ID was detected. */
  detected: boolean;
  /** Confidence score normalized between 0.0 (noise) and 1.0 (perfect correlation). Threshold is ~0.5. */
  confidence: number;
  /** Bit Error Rate between recovered symbols and expected codeword (0.00 to 1.00). */
  ber: number;
  /** Energy-per-bit to noise power spectral density ratio in decibels. */
  ebN0Db: number;
  /** Signal to quantization-noise ratio in decibels. */
  sqnrDb: number;
  /** The 32-bit payload ID recovered from the audio, or null when the CRC failed. */
  recoveredPayloadId: number | null;
  /** Whether the embedded CRC-16 matched the recovered payload. */
  crcOk: boolean;
  /** Number of repeated frames folded for detection (>= 1). */
  reps: number;
  /** Mean aligned watermark amplitude. */
  amplitude: number;
  details: DetectionDetails;
  /** Set when a retry sweep recovered the watermark, e.g. 1.002 for +0.2% pitch drift. */
  driftFactor?: number;
  resampled?: boolean;
  originalSampleRate?: number;
  normalizedSampleRate?: number;
}

/** Float32Array of marked samples with an attached metadata record. */
export interface EmbeddedAudio extends Float32Array {
  watermarkMeta: WatermarkMetadata;
}

/**
 * Embeds an imperceptible spread-spectrum watermark carrying a 32-bit ID into audio.
 *
 * @param samples Interleaved Float32Array audio samples in [-1.0, 1.0].
 * @param fmt Audio format containing sampleRate and channels.
 * @param params Options: payloadId, key, strength, band.
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
 * @param fmt Audio format containing sampleRate and channels.
 * @param opts Detection options: key, payloadId (for verify mode), band, resample, drift.
 */
export function detectWatermark(
  samples: Float32Array,
  fmt: AudioFormat,
  opts?: DetectOptions
): DetectionResult;

/**
 * Parses uncompressed RIFF/WAVE PCM or 32-bit float audio from an in-memory buffer.
 * Throws `WavError` for non-PCM / unsupported files.
 *
 * @param bytes Raw byte buffer of a WAV file.
 */
export function parseWav(bytes: Uint8Array): ParsedWav;

/**
 * Encodes normalized float audio into a standard RIFF/WAVE byte buffer.
 * `bitDepth: 32` writes 32-bit IEEE float, otherwise 16/24/32-bit integer PCM.
 *
 * @param samples Interleaved Float32Array samples in [-1.0, 1.0].
 * @param fmt Target format containing sampleRate, channels, and optional bitDepth.
 */
export function writeWav(samples: Float32Array, fmt: AudioFormat): Uint8Array;

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
 * @param samples Interleaved Float32Array samples in [-1.0, 1.0].
 * @param fmt Format options: sampleRate, channels, bitDepth (default: 16).
 */
export function writeWavFile(
  path: string,
  samples: Float32Array,
  fmt: AudioFormat
): Promise<void>;

export class WavError extends Error {}

/**
 * Generates synthetic speech-like harmonic test audio for benchmarks and demos.
 */
export function synthesizeSpeechLike(opts?: {
  seconds?: number;
  sampleRate?: number;
  channels?: number;
  seed?: string | number;
  /** Peak amplitude, clamped to [0.05, 0.95]. Default: 0.5. */
  peak?: number;
}): Float32Array;

/**
 * Computes CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF) over a byte sequence.
 */
export function crc16(bytes: ArrayLike<number>): number;

/**
 * Packs a 32-bit integer ID into a 48-symbol BPSK codeword (+1/-1) with a 16-bit CRC.
 * Throws TypeError when `id` is not an unsigned 32-bit integer.
 */
export function packCodeword(id: number): Int8Array;

/**
 * Decodes a 48-symbol BPSK codeword back to a 32-bit ID and checks its CRC.
 * Throws RangeError when the codeword is not 48 symbols long.
 */
export function unpackCodeword(symbols: ArrayLike<number>): {
  id: number;
  crcOk: boolean;
};

/**
 * Verifies if a value is a valid 32-bit unsigned integer ID.
 */
export function isValidPayloadId(id: unknown): id is number;

export const DEFAULT_BAND: Readonly<Band>;
export const BITS_PER_CODEWORD: 48;
export const POLAR_ORGANIZATION_ID: string;

export interface PolarValidationResult {
  valid: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

export interface PolarActivationResult {
  success: boolean;
  license?: Record<string, unknown>;
  error?: string;
}

/** Persisted license record. The raw key is never written to disk. */
export interface LocalLicenseRecord {
  status: "granted" | "active";
  customerEmail?: string;
  customerName?: string;
  displayKey?: string;
  activatedAt?: string;
  expiresAt?: string;
  [key: string]: unknown;
}

export interface LicenseStatus {
  isLicensed: boolean;
  tier: "commercial_pro" | "community_noncommercial";
  tierLabel: string;
  customer: string | null;
  displayKey: string | null;
  activatedAt: string | null;
  expiresAt: string | null;
}

/**
 * Validates a commercial Polar.sh license key without activating a new machine seat.
 */
export function validatePolarKey(key: string): Promise<PolarValidationResult>;

/**
 * Activates a commercial Polar.sh license key and caches credentials locally.
 */
export function activatePolarKey(key: string, label?: string): Promise<PolarActivationResult>;

/**
 * Loads the current cached license record from disk (null when absent/expired).
 */
export function loadLocalLicense(): LocalLicenseRecord | null;

/**
 * Saves a license record to the local offline cache. The record is sanitized so
 * the raw key is never persisted. Failures are logged, not thrown.
 */
export function saveLocalLicense(record: Record<string, unknown>): void;

/**
 * Deactivates and removes the local license cache. Returns false when the file
 * could not be removed.
 */
export function clearLocalLicense(): boolean;

/**
 * Checks if the current machine has an active cached commercial license.
 */
export function getLicenseStatus(): LicenseStatus;

/**
 * Obfuscates sensitive characters of a license key string for display.
 */
export function maskKey(key: string): string;

export interface ForensicReportOptions {
  detectionResult: DetectionResult;
  audioBytes: Uint8Array | Buffer;
  audioMetadata?: Partial<AudioFormat & { durationSec: number; format: string }>;
  filePath?: string;
  expectedPayloadId?: number | null;
  /** Shared-secret key for the HMAC-SHA256 report seal. */
  secret?: string;
}

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
    carrierBand: Band | null;
    syncMethod: string;
    resyncShiftSamples: number;
  };
  interpretation: {
    note: string;
    methodology: string;
  };
  signature: {
    algorithm: string;
    seal: string;
    verified: boolean;
  };
}

export const REPORT_SCHEMA_VERSION: string;
export const ENGINE_NAME: string;
export const ENGINE_VERSION: string;

/**
 * Generates a detection audit report with file hashes and a shared-key HMAC seal.
 * The report does not establish authorship, identity, or chain of custody.
 */
export function generateForensicReport(options: ForensicReportOptions): ForensicReport;

/**
 * Formats a detection audit report into human-readable text.
 */
export function formatForensicReportText(report: ForensicReport): string;

export interface TardosCodebookOptions {
  /** Number of recipients in the distribution list. */
  numRecipients: number;
  /** Symbols per code (default: 48, one watermark frame). */
  codeLength?: number;
  /** Expected maximum colluding coalition size (default: 4). */
  maxCoalition?: number;
  /** Deterministic master seed for the codebook. */
  seedKey?: string;
}

export interface TardosCodebook {
  biases: number[];
  cutoff: number;
  codeLength: number;
  /** One BPSK codeword (-1/+1) per recipient, aligned with its index in the input list. */
  codebook: Int8Array[];
}

export interface TardosRecipient {
  id: string | number;
  name: string;
  codeword: ArrayLike<number>;
}

export interface TardosSuspect {
  id: string | number;
  name: string;
  score: number;
  normalizedScore: number;
}

export interface TardosAccusation {
  accused: TardosSuspect[];
  isCollusion: boolean;
  topSuspect: TardosSuspect | null;
  threshold: number;
  medianScore: number;
  robustStdDev: number;
  rankedScores: TardosSuspect[];
}

/**
 * Generates a symmetric Tardos fingerprint codebook for a recipient list.
 */
export function generateTardosCodebook(opts: TardosCodebookOptions): TardosCodebook;

/**
 * Scores recipients against recovered soft symbols and returns accused colluders.
 *
 * @param softSymbols Per-symbol soft correlations from `DetectionResult.details.softSymbols`.
 * @param recipients Recipient list with their Tardos codewords.
 * @param biases Bias vector returned by `generateTardosCodebook`.
 */
export function accuseCoalition(
  softSymbols: ArrayLike<number>,
  recipients: TardosRecipient[],
  biases: ArrayLike<number>
): TardosAccusation;
