// test/server.test.js — End-to-end integration tests for REST Microservice
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

import { createAurealServer } from "../docker/server.js";
import { synthesizeSpeechLike } from "../src/synth.js";
import { parseWav, writeWav } from "../src/wav.js";

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
  assert.equal(detectData.forensicReport.verification.status, "WATERMARK_DETECTED");
  assert.ok(detectData.forensicReport.targetFile.hashes.sha256.length === 64);
  assert.ok(detectData.forensicReport.signature.seal.length === 64);
  assert.equal(detectData.forensicReport.signature.verified, false);
  assert.match(detectData.forensicReport.interpretation.note, /not proof of authorship/);
  assert.ok(detectData.forensicCertificateText.includes("AUREAL WATERMARK — DETECTION AUDIT REPORT"));
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

test("CORS preflight answers OPTIONS with permissive headers", async () => {
  const res = await fetch(`${baseUrl}/v1/embed`, { method: "OPTIONS" });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get("access-control-allow-origin"), "*");
  assert.match(res.headers.get("access-control-allow-methods"), /POST/);
  await res.arrayBuffer();
});

test("binary embed preserves 24-bit PCM word depth", async () => {
  const pcm = synthesizeSpeechLike({ seconds: 3, sampleRate: 44100, channels: 2 });
  const wav24 = writeWav(pcm, { sampleRate: 44100, channels: 2, bitDepth: 24 });

  const embedRes = await fetch(`${baseUrl}/v1/embed?id=246810&band=dual`, {
    method: "POST",
    headers: { "Content-Type": "audio/wav" },
    body: wav24
  });
  assert.equal(embedRes.status, 200);
  const out = Buffer.from(await embedRes.arrayBuffer());
  const parsed = parseWav(out);
  assert.equal(parsed.bitsPerSample, 24, "embed output should keep 24-bit depth");
  assert.equal(parsed.channels, 2);

  const detectRes = await fetch(`${baseUrl}/v1/detect?id=246810`, {
    method: "POST",
    headers: { "Content-Type": "audio/wav" },
    body: out
  });
  assert.equal(detectRes.status, 200);
  const data = await detectRes.json();
  assert.equal(data.detected, true);
  assert.equal(data.recoveredPayloadId, 246810);
});

test("header-based parameters work for embed and detect", async () => {
  const pcm = synthesizeSpeechLike({ seconds: 3, sampleRate: 44100, channels: 1 });
  const cleanWav = writeWav(pcm, { sampleRate: 44100, channels: 1, bitDepth: 16 });

  const embedRes = await fetch(`${baseUrl}/v1/embed`, {
    method: "POST",
    headers: {
      "Content-Type": "audio/wav",
      "X-Aureal-Payload-Id": "777777",
      "X-Aureal-Key": "header-key",
      "X-Aureal-Strength": "0.6",
      "X-Aureal-Band": "high"
    },
    body: cleanWav
  });
  assert.equal(embedRes.status, 200);
  assert.equal(embedRes.headers.get("x-aureal-payload-id"), "777777");

  const detectRes = await fetch(`${baseUrl}/v1/detect`, {
    method: "POST",
    headers: {
      "Content-Type": "audio/wav",
      "X-Aureal-Payload-Id": "777777",
      "X-Aureal-Key": "header-key"
    },
    body: Buffer.from(await embedRes.arrayBuffer())
  });
  assert.equal(detectRes.status, 200);
  const data = await detectRes.json();
  assert.equal(data.detected, true);
  assert.equal(data.recoveredPayloadId, 777777);
});

test("custom numeric band 'lowHz:highHz' is accepted", async () => {
  const pcm = synthesizeSpeechLike({ seconds: 3, sampleRate: 44100, channels: 1 });
  const cleanWav = writeWav(pcm, { sampleRate: 44100, channels: 1, bitDepth: 16 });

  const embedRes = await fetch(`${baseUrl}/v1/embed?id=13579&band=17000:19500&format=wav`, {
    method: "POST",
    headers: { "Content-Type": "audio/wav" },
    body: cleanWav
  });
  assert.equal(embedRes.status, 200);
  assert.equal(embedRes.headers.get("x-aureal-band"), "17000:19500");

  const detectRes = await fetch(`${baseUrl}/v1/detect?id=13579&band=17000:19500`, {
    method: "POST",
    headers: { "Content-Type": "audio/wav" },
    body: Buffer.from(await embedRes.arrayBuffer())
  });
  const data = await detectRes.json();
  assert.equal(data.detected, true);
  assert.equal(data.details.bandUsed.lowHz, 17000);
});

test("malformed JSON body is a 400, not a 500", async () => {
  const res = await fetch(`${baseUrl}/v1/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{not json"
  });
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.match(data.error, /not valid JSON/);
});

test("unsupported output format is rejected with 400", async () => {
  const pcm = synthesizeSpeechLike({ seconds: 3, sampleRate: 44100, channels: 1 });
  const cleanWav = writeWav(pcm, { sampleRate: 44100, channels: 1, bitDepth: 16 });
  const res = await fetch(`${baseUrl}/v1/embed?id=123&format=exe`, {
    method: "POST",
    headers: { "Content-Type": "audio/wav" },
    body: cleanWav
  });
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.match(data.error, /Unsupported output format/);
});

test("detect rejects a malformed expected id", async () => {
  const res = await fetch(`${baseUrl}/v1/detect?id=notanumber`, {
    method: "POST",
    headers: { "Content-Type": "audio/wav" },
    body: Buffer.alloc(64)
  });
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.match(data.error, /unsigned 32-bit integer/);
});

test("detect with report=true and an expected id reports WATERMARK_ID_MATCH", async () => {
  const pcm = synthesizeSpeechLike({ seconds: 3, sampleRate: 44100, channels: 1 });
  const cleanWav = writeWav(pcm, { sampleRate: 44100, channels: 1, bitDepth: 16 });
  const embedRes = await fetch(`${baseUrl}/v1/embed?id=424242`, {
    method: "POST",
    headers: { "Content-Type": "audio/wav" },
    body: cleanWav
  });
  const marked = Buffer.from(await embedRes.arrayBuffer());
  const detectRes = await fetch(`${baseUrl}/v1/detect?id=424242&report=true`, {
    method: "POST",
    headers: { "Content-Type": "audio/wav" },
    body: marked
  });
  const data = await detectRes.json();
  assert.equal(data.detected, true);
  assert.equal(data.forensicReport.verification.status, "WATERMARK_ID_MATCH");
  assert.equal(data.forensicReport.verification.expectedPayloadId, 424242);
  assert.match(data.forensicCertificateText, /\[?WATERMARK[ _]ID[ _]MATCH\]?/);
});
