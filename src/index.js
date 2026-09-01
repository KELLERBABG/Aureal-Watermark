// index.js — public API surface of the auralwatermark core engine.

export { embedWatermark } from "./embed.js";
export { detectWatermark } from "./detect.js";
export { parseWav, writeWav, readWavFile, writeWavFile, WavError } from "./wav.js";
export { synthesizeSpeechLike } from "./synth.js";
export { crc16, packCodeword, unpackCodeword, isValidPayloadId } from "./payload.js";
export { DEFAULT_BAND, BITS_PER_CODEWORD } from "./signal.js";
