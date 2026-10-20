import test from "node:test";
import assert from "node:assert/strict";
import { startServer, tone, wavBuffer } from "./helpers.js";

const SR = 44100;
const CH = 2;

function body() {
  return wavBuffer(tone(6, SR, CH, "rest"), SR, CH);
}

test("REST service: health, root and 404", async () => {
  const { base, child } = await startServer();
  try {
    const health = await (await fetch(base + "/v1/health")).json();
    assert.equal(health.status, "ok");
    assert.equal(health.service, "aureal-watermark-microservice");
    assert.equal(health.dsp, "active");
    assert.equal(typeof health.ffmpeg, "boolean");

    const root = await (await fetch(base + "/")).json();
    assert.ok(root.endpoints["GET /v1/health"]);

    const notFound = await fetch(base + "/v1/nope");
    assert.equal(notFound.status, 404);
    assert.ok((await notFound.json()).error);
  } finally {
    child.kill();
  }
});

test("REST service: binary embed -> detect round-trip", async () => {
  const { base, child } = await startServer();
  try {
    const embed = await fetch(`${base}/v1/embed?id=883921&key=srv`, { method: "POST", body: body() });
    assert.equal(embed.status, 200);
    assert.match(embed.headers.get("content-type"), /audio\/wav/);
    assert.equal(embed.headers.get("x-aureal-payload-id"), "883921");
    const marked = Buffer.from(await embed.arrayBuffer());
    assert.equal(marked.toString("ascii", 0, 4), "RIFF");

    const detect = await (
      await fetch(`${base}/v1/detect?id=883921&key=srv`, { method: "POST", body: marked })
    ).json();
    assert.equal(detect.detected, true);
    assert.equal(detect.recoveredPayloadId, 883921);

    const wrongId = await (
      await fetch(`${base}/v1/detect?id=111&key=srv`, { method: "POST", body: marked })
    ).json();
    assert.equal(wrongId.detected, false);
  } finally {
    child.kill();
  }
});

test("REST service: JSON / base64 mode works both ways", async () => {
  const { base, child } = await startServer();
  try {
    const embed = await (
      await fetch(`${base}/v1/embed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audioBase64: body().toString("base64"), id: 555000, key: "js" }),
      })
    ).json();
    assert.equal(embed.success, true);
    assert.equal(embed.payloadId, 555000);
    const marked = Buffer.from(embed.audioBase64, "base64");

    const detect = await (
      await fetch(`${base}/v1/detect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audioBase64: marked.toString("base64"), id: 555000, key: "js" }),
      })
    ).json();
    assert.equal(detect.detected, true);
    assert.equal(detect.recoveredPayloadId, 555000);
  } finally {
    child.kill();
  }
});

test("REST service: the output format is an allow-list (no shell injection)", async () => {
  const { base, child } = await startServer();
  try {
    for (const bad of ['mp3" & echo pwned & rem "', "../evil", "mp3;id", "wavx"]) {
      const res = await fetch(`${base}/v1/embed?id=1&format=${encodeURIComponent(bad)}`, { method: "POST", body: body() });
      assert.equal(res.status, 400, `format '${bad}' should be rejected`);
      assert.match((await res.json()).error, /Unsupported output format/);
    }
  } finally {
    child.kill();
  }
});

test("REST service: 24-bit input keeps its bit depth", async () => {
  const { base, child } = await startServer();
  try {
    const res = await fetch(`${base}/v1/embed?id=123456&key=k`, { method: "POST", body: wavBuffer(tone(6, SR, CH, "hi-res"), SR, CH, 24) });
    assert.equal(res.status, 200);
    const out = Buffer.from(await res.arrayBuffer());
    assert.equal(out.readUInt16LE(34), 24, "output bit depth");
  } finally {
    child.kill();
  }
});

test("REST service: error semantics are 4xx for bad input, 2xx only on success", async () => {
  const { base, child } = await startServer();
  try {
    const missingId = await fetch(`${base}/v1/embed`, { method: "POST", body: body() });
    assert.equal(missingId.status, 400);

    const badId = await fetch(`${base}/v1/embed?id=abc`, { method: "POST", body: body() });
    assert.equal(badId.status, 400);

    const negativeId = await fetch(`${base}/v1/embed?id=-5`, { method: "POST", body: body() });
    assert.equal(negativeId.status, 400);

    const malformed = await fetch(`${base}/v1/embed?id=1`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not json",
    });
    assert.equal(malformed.status, 400, "malformed JSON");

    const noAudio = await fetch(`${base}/v1/embed?id=1`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nope: true }),
    });
    assert.equal(noAudio.status, 400);

    const notAudio = await fetch(`${base}/v1/embed?id=1`, { method: "POST", body: Buffer.from("not audio at all") });
    assert.ok(notAudio.status >= 400 && notAudio.status < 500, `non-audio status ${notAudio.status}`);

    const tooShort = await fetch(`${base}/v1/embed?id=1`, { method: "POST", body: wavBuffer(tone(0.05, SR, CH, "tiny"), SR, CH) });
    assert.ok(tooShort.status >= 400 && tooShort.status < 500, `too-short status ${tooShort.status}`);
  } finally {
    child.kill();
  }
});

test("REST service: CORS preflight and headers", async () => {
  const { base, child } = await startServer();
  try {
    const preflight = await fetch(base + "/v1/embed", { method: "OPTIONS" });
    assert.ok([200, 204].includes(preflight.status));
    assert.equal(preflight.headers.get("access-control-allow-origin"), "*");
    assert.match(preflight.headers.get("access-control-allow-headers"), /X-Aureal-Report/);

    const res = await fetch(`${base}/v1/detect`, { method: "POST", body: body() });
    assert.equal(res.headers.get("access-control-allow-origin"), "*");
  } finally {
    child.kill();
  }
});

test("REST service: forensic report is returned with a verifiable seal", async () => {
  const { base, child } = await startServer();
  try {
    const embed = await fetch(`${base}/v1/embed?id=777&key=rep`, { method: "POST", body: body() });
    const marked = Buffer.from(await embed.arrayBuffer());
    const detect = await (await fetch(`${base}/v1/detect?id=777&key=rep&report=true`, { method: "POST", body: marked })).json();
    assert.equal(detect.forensicReport.verification.status, "WATERMARK_ID_MATCH");
    assert.equal(detect.forensicReport.targetFile.sizeBytes, marked.length);
    const { verifyForensicReport } = await import("../src/index.js");
    assert.equal(verifyForensicReport(detect.forensicReport, { secret: "rep" }).valid, true);
  } finally {
    child.kill();
  }
});
