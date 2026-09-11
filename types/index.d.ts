/**
 * Type declarations for Aureal Watermark.
 * Acoustic steganography, digital provenance, and anti-theft audio watermarking.
 */

export interface AudioFormat {
  /** Sample rate in Hz (e.g. 44100, 48000, 96000). Must be an integer between 8,000 and 768,000. */
  sampleRate: number;
  /** Number of interleaved channels (1 to 64). */
  channels: number;
  /** Bit depth for integer PCM (16, 24, 32) or 32 for float. */
  bitDepth?: 16 | 24 | 32;
}

export interface ParsedWav {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  numFrames: number;
  durationSec: number;
  samples: Float32Array;
  format: string;
}

export type BandPresetName = "high" | "mid" | "dual" | "auto";

export interface CustomBand {
  lowHz: number;
  highHz: number;
  centerHz?: number;
}

export type BandSpec = BandPresetName | CustomBand;

export interface WatermarkOptions {
  /** 32-bit unsigned integer ID to embed (0 to 4,294,967,295). */
  payloadId: number;
  /** Cryptographic passkey used to seed the pseudo-random carrier sequence. Default: internal key. */
  key?: string;
  /** Watermark amplitude strength factor between 0.01 and 1.0. Default: 0.5. */
  strength?: number;
  /** Frequency band specification ("dual", "high", "mid", or custom { lowHz, highHz }). Default: "dual". */
  band?: BandSpec;
}

export interface WatermarkMetadata {
  key: string;
  payloadId: number;
  strength: number;
  bands: CustomBand[];
  band: CustomBand;
  peakWatermark: number;
  geometry: {
    slotLen: number;
    chipLen: number;
    frameLen: number;
    reps: number;
    bits: number;
  };
}

export interface DetectOptions {
  /** Cryptographic passkey used during embedding. */
  key?: string;
  /** Expected 32-bit uint ID to verify. If omitted, blind detection with CRC recovery is performed. */
  payloadId?: number;
  /** Band to inspect ("auto", "dual", "high", "mid", or custom { lowHz, highHz }). Default: "auto". */
  band?: BandSpec;
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
  /** The 32-bit payload ID recovered from the audio (or null if not detected). */
  recoveredPayloadId: number | null;
  /** Diagnostic matching metadata. */
  details: {
    mode: "verify" | "blind";
    bandUsed: CustomBand | null;
    bandsTried: number;
    bits: number;
    bitsCorrected?: number[];
    syncMethod?: string;
    rawCorrelation?: number;
  };
}

export interface PolarLicenseStatus {
  isLicensed: boolean;
  customer: string;
  keyMasked: string;
  status: "active" | "granted" | "unlicensed" | "expired";
  storagePath: string;
}

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

/**
 * Embeds an inaudible spread-spectrum watermark into PCM audio samples.
 *
 * @param pcm Interleaved 32-bit floating point audio samples in the range [-1.0, 1.0].
 * @param fmt Format descriptors: sampleRate and channel count.
 * @param opts Watermark configuration (payloadId, key, strength, band).
 * @returns A new Float32Array containing the watermarked audio, augmented with a `watermarkMeta` property.
 */
export function embedWatermark(
  pcm: Float32Array,
  fmt: AudioFormat,
  opts: WatermarkOptions
): Float32Array & { watermarkMeta: WatermarkMetadata };

/**
 * Detects and extracts an acoustic watermark from PCM audio samples.
 *
 * @param pcm Interleaved 32-bit floating point audio samples in the range [-1.0, 1.0].
 * @param fmt Format descriptors: sampleRate and channel count.
 * @param opts Detection parameters (key, expected payloadId, band).
 * @returns Detection result containing confidence, BER, and recovered payload ID.
 */
export function detectWatermark(
  pcm: Float32Array,
  fmt: AudioFormat,
  opts?: DetectOptions
): DetectionResult;

/**
 * Parses uncompressed RIFF/WAVE PCM audio from an in-memory buffer.
 *
 * @param bytes Raw byte buffer of a WAV file.
 */
export function parseWav(bytes: Uint8Array | Buffer): ParsedWav;

/**
 * Encodes 32-bit float PCM audio into a standard RIFF/WAVE byte buffer.
 *
 * @param samples Interleaved Float32Array samples in [-1.0, 1.0].
 * @param fmt Target format containing sampleRate, channels, and optional bitDepth (16, 24, 32).
 */
export function writeWav(
  samples: Float32Array,
  fmt: AudioFormat
): Buffer;

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
}): Float32Array;

/**
 * Computes CRC-16/CCITT-FALSE checksum over a 32-bit integer.
 */
export function crc16(id: number): number;

/**
 * Packs a 32-bit integer ID into a 48-symbol BPSK codeword (+1/-1) with 16-bit CRC.
 */
export function packCodeword(id: number): Int8Array;

/**
 * Decodes and error-corrects a 48-symbol BPSK codeword back to a 32-bit ID.
 */
export function unpackCodeword(symbols: ArrayLike<number>): {
  id: number | null;
  valid: boolean;
  correctedBits?: number[];
};

/**
 * Verifies if a number is a valid 32-bit unsigned integer ID.
 */
export function isValidPayloadId(id: unknown): id is number;

export const DEFAULT_BAND: Readonly<CustomBand>;
export const BITS_PER_CODEWORD: number;
export const POLAR_ORGANIZATION_ID: string;

/**
 * Validates a commercial Polar.sh license key without activating a new machine seat.
 */
export function validatePolarKey(key: string): Promise<PolarValidationResult>;

/**
 * Activates a commercial Polar.sh license key and caches credentials locally.
 */
export function activatePolarKey(key: string, label?: string): Promise<PolarActivationResult>;

/**
 * Loads the current cached license record from disk.
 */
export function loadLocalLicense(): Record<string, unknown> | null;

/**
 * Saves a license record to the local offline cache.
 */
export function saveLocalLicense(record: Record<string, unknown>): boolean;

/**
 * Deactivates and removes the local license cache.
 */
export function clearLocalLicense(): boolean;

/**
 * Checks if the current machine has an active cached commercial license.
 */
export function getLicenseStatus(): PolarLicenseStatus;

/**
 * Obfuscates sensitive characters of a license key string for display.
 */
export function maskKey(key: string): string;
