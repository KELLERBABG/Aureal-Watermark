// test/server.test.js — End-to-end integration tests for REST Microservice
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

import { createAurealServer } from "../docker/server.js";
import { synthesizeSpeechLike } from "../src/synth.js";
import { writeWav } from "../src/wav.js";

let server;
let baseUrl;

before(async () => {
  server = createAurealServer();
  await new Promise((resolve) => {
    // Listen on dynamic port 0
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
});

after(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("GET /v1/health returns ok status and engine health", async () => {
  const res = await fetch(`${baseUrl}/v1/health`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.status, "ok");
  assert.equal(data.service, "aureal-watermark-microservice");
  assert.equal(data.dsp, "active");
  assert.ok(typeof data.ffmpeg === "boolean");
});

test("GET / returns service directory info", async () => {
  const res = await fetch(`${baseUrl}/`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(data.endpoints["POST /v1/embed"]);
  assert.ok(data.endpoints["POST /v1/detect"]);
});

test("POST /v1/embed and POST /v1/detect with raw binary WAV stream", async () => {
  const pcm = synthesizeSpeechLike({ seconds: 3, sampleRate: 44100, channels: 1 });
  const cleanWav = writeWav(pcm, { sampleRate: 44100, channels: 1, bitDepth: 16 });

  // 1. Embed via binary stream
  const embedRes = await fetch(`${baseUrl}/v1/embed?id=334455&strength=0.6&band=dual`, {
    method: "POST",
    headers: { "Content-Type": "audio/wav" },
    body: cleanWav
  });

  assert.equal(embedRes.status, 200);
  assert.equal(embedRes.headers.get("x-aureal-payload-id"), "334455");
  assert.equal(embedRes.headers.get("content-type"), "audio/wav");

  const watermarkedBytes = Buffer.from(await embedRes.arrayBuffer());
  assert.ok(watermarkedBytes.length > 0);

  // 2. Detect via binary stream
  const detectRes = await fetch(`${baseUrl}/v1/detect?id=334455`, {
    method: "POST",
    headers: { "Content-Type": "audio/wav" },
    body: watermarkedBytes
  });

  assert.equal(detectRes.status, 200);
  const detectData = await detectRes.json();
  assert.equal(detectData.detected, true);
  assert.equal(detectData.recoveredPayloadId, 334455);
  assert.ok(detectData.confidence >= 0.95);
  assert.equal(detectData.ber, 0);
  assert.equal(detectData.crcOk, true);
});

test("POST /v1/embed and POST /v1/detect with JSON Base64 payload and forensic report", async () => {
  const pcm = synthesizeSpeechLike({ seconds: 3, sampleRate: 44100, channels: 1 });
  const cleanWav = writeWav(pcm, { sampleRate: 44100, channels: 1, bitDepth: 16 });

  // 1. Embed via JSON
  const embedRes = await fetch(`${baseUrl}/v1/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: 987654,
      audioBase64: cleanWav.toString("base64"),
      key: "microservice-secret",
      strength: 0.5,
      band: "dual",
      format: "wav"
    })
  });

  assert.equal(embedRes.status, 200);
  const embedData = await embedRes.json();
  assert.equal(embedData.success, true);
  assert.equal(embedData.payloadId, 987654);
  assert.ok(embedData.audioBase64.length > 0);

  // 2. Detect via JSON with report: true
  const detectRes = await fetch(`${baseUrl}/v1/detect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      audioBase64: embedData.audioBase64,
      key: "microservice-secret",
      report: true
    })
  });

  assert.equal(detectRes.status, 200);
  const detectData = await detectRes.json();
  assert.equal(detectData.detected, true);
  assert.equal(detectData.recoveredPayloadId, 987654);

  // Verify forensic report inclusion
  assert.ok(detectData.forensicReport);
  assert.equal(detectData.forensicReport.verification.status, "VERIFIED_AUTHENTIC");
  assert.ok(detectData.forensicReport.targetFile.hashes.sha256.length === 64);
  assert.ok(detectData.forensicReport.signature.seal.length === 64);
  assert.ok(detectData.forensicCertificateText.includes("AUREAL WATERMARK — FORENSIC PROOF CERTIFICATE"));
});

test("POST /v1/embed rejects requests without valid payload ID", async () => {
  const res = await fetch(`${baseUrl}/v1/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ audioBase64: "dummy" })
  });

  assert.equal(res.status, 400);
  const data = await res.json();
  assert.match(data.error, /unsigned 32-bit integer/);
});

test("Unknown endpoint returns 404 Not Found", async () => {
  const res = await fetch(`${baseUrl}/v1/nonexistent`);
  assert.equal(res.status, 404);
  const data = await res.json();
  assert.match(data.error, /Endpoint not found/);
});
