import test from "node:test";
import assert from "node:assert/strict";
import { crc16, packCodeword, unpackCodeword, isValidPayloadId, BITS_PER_CODEWORD } from "../src/index.js";

test("crc16 matches the CRC-16/CCITT-FALSE check vector", () => {
  assert.equal(crc16([...Buffer.from("123456789")]), 0x29b1);
});

test("crc16 is defined over the four big-endian payload bytes", () => {
  assert.equal(crc16([0, 0, 0, 0]), crc16([0, 0, 0, 0]));
  assert.notEqual(crc16([0, 0, 0, 1]), crc16([0, 0, 0, 2]));
  assert.equal(crc16([]), 0xffff);
});

test("packCodeword produces 48 BPSK symbols, MSB first", () => {
  const cw = packCodeword(0x80000000);
  assert.equal(cw.length, BITS_PER_CODEWORD);
  assert.equal(cw[0], 1);
  for (let i = 1; i < 32; i++) assert.equal(cw[i], -1);
});

test("packCodeword / unpackCodeword round-trips boundary IDs", () => {
  for (const id of [0, 1, 255, 65535, 65536, 0x7fffffff, 0xfffffffe, 0xffffffff, 883921]) {
    const { id: decoded, crcOk } = unpackCodeword(packCodeword(id));
    assert.equal(decoded, id, `id ${id}`);
    assert.equal(crcOk, true, `crc for ${id}`);
  }
});

test("unpackCodeword flags a corrupted codeword", () => {
  const cw = packCodeword(123456789);
  cw[0] = -cw[0];
  const { crcOk } = unpackCodeword(cw);
  assert.equal(crcOk, false);
});

test("unpackCodeword rejects a codeword of the wrong length", () => {
  assert.throws(() => unpackCodeword(new Int8Array(10)), RangeError);
});

test("isValidPayloadId accepts uint32 and rejects everything else", () => {
  for (const ok of [0, 1, 2 ** 32 - 1]) assert.equal(isValidPayloadId(ok), true);
  for (const bad of [-1, 1.5, 2 ** 32, NaN, "1", null, undefined]) assert.equal(isValidPayloadId(bad), false);
});

test("packCodeword rejects out-of-range IDs", () => {
  assert.throws(() => packCodeword(-1), TypeError);
  assert.throws(() => packCodeword(2 ** 32), TypeError);
  assert.throws(() => packCodeword(1.5), TypeError);
});
