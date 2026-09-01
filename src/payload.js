// payload.js — 32-bit payload id + 16-bit CRC16 codeword packing.

export const PAYLOAD_BITS = 32;
export const CRC_BITS = 16;
export { BITS_PER_CODEWORD } from "./signal.js";
import { BITS_PER_CODEWORD } from "./signal.js";

/** CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF, no reflect, no xorout). */
export function crc16(bytes) {
  let crc = 0xffff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i] << 8;
    for (let b = 0; b < 8; b++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc >>> 0;
}

/** @returns {boolean} true if v is a valid payload id (uint32) */
export function isValidPayloadId(v) {
  return Number.isInteger(v) && v >= 0 && v <= 0xffffffff;
}

/**
 * Pack a payload id into a ±1 codeword of length 48:
 * [32 id bits MSB-first][16 CRC bits over the id bytes, MSB-first].
 * Bit value 1 -> +1, bit value 0 -> -1 (BPSK mapping).
 * @param {number} payloadId uint32
 * @returns {Int8Array} length 48
 */
export function packCodeword(payloadId) {
  if (!isValidPayloadId(payloadId)) {
    throw new TypeError(`payloadId must be an integer in [0, 2^32-1], got ${payloadId}`);
  }
  const out = new Int8Array(BITS_PER_CODEWORD);
  for (let i = 0; i < PAYLOAD_BITS; i++) {
    out[i] = (payloadId >>> (PAYLOAD_BITS - 1 - i)) & 1 ? 1 : -1;
  }
  const bytes = [
    (payloadId >>> 24) & 0xff,
    (payloadId >>> 16) & 0xff,
    (payloadId >>> 8) & 0xff,
    payloadId & 0xff,
  ];
  const crc = crc16(bytes);
  for (let i = 0; i < CRC_BITS; i++) {
    out[PAYLOAD_BITS + i] = (crc >>> (CRC_BITS - 1 - i)) & 1 ? 1 : -1;
  }
  return out;
}

/**
 * Unpack hard bit values (±1 or any sign) back to {id, crcOk}.
 * @param {Int8Array|Array<number>} cw length 48
 */
export function unpackCodeword(cw) {
  if (cw.length !== BITS_PER_CODEWORD) throw new RangeError("codeword must have 48 symbols");
  let id = 0;
  for (let i = 0; i < PAYLOAD_BITS; i++) {
    id = Math.imul(id, 2) + (cw[i] > 0 ? 1 : 0);
  }
  let crcRx = 0;
  for (let i = 0; i < CRC_BITS; i++) {
    crcRx = Math.imul(crcRx, 2) + (cw[PAYLOAD_BITS + i] > 0 ? 1 : 0);
  }
  const crcCalc = crc16([(id >>> 24) & 255, (id >>> 16) & 255, (id >>> 8) & 255, id & 255]);
  return { id: id >>> 0, crcOk: crcCalc === crcRx };
}

/** Hamming distance between two codewords. */
export function hamming(a, b) {
  let d = 0;
  for (let i = 0; i < a.length; i++) if ((a[i] > 0) !== (b[i] > 0)) d++;
  return d;
}
