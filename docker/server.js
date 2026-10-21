// docker/server.js — High-performance, zero-dependency HTTP REST Microservice for Aureal Watermark
//
// SECURITY: every external process is spawned with execFileSync(program, args[]) so no
// caller-controlled value is ever parsed by a shell. Caller-supplied output formats are
// validated against OUTPUT_FORMATS before use.
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileSync, readFileSync, unlinkSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";

import { embedWatermark, validateFmt } from "../src/embed.js";
import { detectWatermark } from "../src/detect.js";
import { parseWav, writeWav } from "../src/wav.js";
import { generateForensicReport, formatForensicReportText } from "../src/report.js";

const DEFAULT_KEY = "aural-watermark-default-key";
const MAX_BODY_BYTES = (Number(process.env.MAX_BODY_SIZE_MB) || 100) * 1024 * 1024;
const FFMPEG_TIMEOUT_MS = Number(process.env.FFMPEG_TIMEOUT_MS) || 120_000;
const FFMPEG_BIN = process.env.FFMPEG_BIN || "ffmpeg";
const CORS_ALLOW_HEADERS =
  "Content-Type, Authorization, X-Aureal-Payload-Id, X-Aureal-Key, X-Aureal-Strength, X-Aureal-Band, X-Aureal-Format, X-Aureal-Report";

/** Output container allow-list. Anything else is rejected with 400. */
export const OUTPUT_FORMATS = Object.freeze(["wav", "mp3", "flac", "aac", "m4a", "ogg"]);

/** Error carrying the HTTP status the handler should return. */
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

let cachedFfmpeg = null;
export function hasFfmpeg() {
  if (cachedFfmpeg !== null) return cachedFfmpeg;
  try {
    execFileSync(FFMPEG_BIN, ["-version"], { stdio: "ignore", timeout: 15_000 });
    cachedFfmpeg = true;
  } catch {
    cachedFfmpeg = false;
  }
  return cachedFfmpeg;
}

/**
 * Normalise a caller-supplied output format. Returns a member of OUTPUT_FORMATS or null.
 * Only this allow-list value is ever used to build a filename or an ffmpeg argument.
 */
export function normalizeOutputFormat(value) {
  const raw = String(value ?? "wav").trim().toLowerCase().replace(/^\./, "");
  return OUTPUT_FORMATS.includes(raw) ? raw : null;
}

/**
 * Transcode arbitrary audio buffer to in-memory 16-bit PCM WAV.
 */
export function transcodeToWavBuffer(inputBuffer, ext = ".audio") {
  if (!hasFfmpeg()) {
    throw new HttpError(415, "FFmpeg is required to process compressed audio formats in this microservice.");
  }
  const id = randomBytes(8).toString("hex");
  const safeExt = /^\.[a-z0-9]{1,8}$/.test(String(ext)) ? String(ext) : ".audio";
  const tempIn = join(tmpdir(), `aureal_srv_in_${id}${safeExt}`);
  const tempOut = join(tmpdir(), `aureal_srv_out_${id}.wav`);

  try {
    writeFileSync(tempIn, inputBuffer);
    execFileSync(FFMPEG_BIN, ["-y", "-v", "error", "-i", tempIn, "-vn", "-acodec", "pcm_s16le", tempOut], {
      stdio: "pipe",
      timeout: FFMPEG_TIMEOUT_MS,
    });
    return readFileSync(tempOut);
  } catch (err) {
    throw new HttpError(415, `Audio input could not be decoded: ${err.message.split("\n")[0]}`);
  } finally {
    try { if (existsSync(tempIn)) unlinkSync(tempIn); } catch {}
    try { if (existsSync(tempOut)) unlinkSync(tempOut); } catch {}
  }
}

/**
 * Transcode WAV buffer to target compressed container. `targetFormat` is validated
 * against OUTPUT_FORMATS; unknown values throw HttpError(400).
 */
export function transcodeFromWavBuffer(wavBuffer, targetFormat = "wav") {
  const fmt = normalizeOutputFormat(targetFormat);
  if (!fmt) {
    throw new HttpError(400, `Unsupported output format. Use one of: ${OUTPUT_FORMATS.join(", ")}.`);
  }
  if (fmt === "wav") return { buffer: wavBuffer, contentType: "audio/wav" };

  if (!hasFfmpeg()) {
    throw new HttpError(501, `FFmpeg is required to transcode output to '${fmt}'.`);
  }

  const id = randomBytes(8).toString("hex");
  const tempWav = join(tmpdir(), `aureal_srv_trans_${id}.wav`);
  const tempOut = join(tmpdir(), `aureal_srv_trans_${id}.${fmt}`);

  const CODECS = {
    mp3: ["-c:a", "libmp3lame", "-b:a", "320k", "audio/mpeg"],
    flac: ["-c:a", "flac", "audio/flac"],
    aac: ["-c:a", "aac", "-b:a", "256k", "audio/aac"],
    m4a: ["-c:a", "aac", "-b:a", "256k", "audio/mp4"],
    ogg: ["-c:a", "libvorbis", "-q:a", "7", "audio/ogg"],
  };
  const [codecArgs, contentType] = [CODECS[fmt].slice(0, -1), CODECS[fmt].slice(-1)[0]];

  try {
    writeFileSync(tempWav, wavBuffer);
    execFileSync(FFMPEG_BIN, ["-y", "-v", "error", "-i", tempWav, "-vn", ...codecArgs, tempOut], {
      stdio: "pipe",
      timeout: FFMPEG_TIMEOUT_MS,
    });
    return { buffer: readFileSync(tempOut), contentType };
  } catch (err) {
    throw new HttpError(500, `Output transcode to '${fmt}' failed: ${err.message.split("\n")[0]}`);
  } finally {
    try { if (existsSync(tempWav)) unlinkSync(tempWav); } catch {}
    try { if (existsSync(tempOut)) unlinkSync(tempOut); } catch {}
  }
}

function parseBandParam(band) {
  if (!band) return "dual";
  if (typeof band === "object") {
    const low = Number(band.lowHz);
    const high = Number(band.highHz);
    if (Number.isFinite(low) && Number.isFinite(high) && high > low && low > 0) return { lowHz: low, highHz: high };
    throw new HttpError(400, "band object must be {lowHz, highHz} with 0 < lowHz < highHz.");
  }
  const s = String(band).trim().toLowerCase();
  if (s === "high" || s === "mid" || s === "dual" || s === "auto") return s;
  const parts = s.split(":").map(Number);
  if (parts.length === 2 && parts.every(Number.isFinite) && parts[0] > 0 && parts[1] > parts[0]) {
    return { lowHz: parts[0], highHz: parts[1] };
  }
  throw new HttpError(400, "band must be high|mid|dual|auto or lowHz:highHz (0 < low < high).");
}

function sendJson(res, statusCode, data) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": CORS_ALLOW_HEADERS
  });
  res.end(body);
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"]);
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      reject(new HttpError(413, `Payload exceeds maximum size of ${MAX_BODY_BYTES / (1024 * 1024)}MB`));
      return;
    }
    const chunks = [];
    let bytes = 0;
    let settled = false;
    req.on("data", (chunk) => {
      if (settled) return;
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        settled = true;
        chunks.length = 0;
        req.pause();
        reject(new HttpError(413, `Payload exceeds maximum size of ${MAX_BODY_BYTES / (1024 * 1024)}MB`));
      } else {
        chunks.push(chunk);
      }
    });
    req.on("end", () => { if (!settled) { settled = true; resolve(Buffer.concat(chunks)); } });
    req.on("error", (err) => { if (!settled) { settled = true; reject(err); } });
  });
}

function parseJsonBody(rawBody) {
  try {
    return JSON.parse(rawBody.toString("utf8"));
  } catch {
    throw new HttpError(400, "Request body is not valid JSON.");
  }
}

function numberParam(raw, name) {
  if (raw === undefined || raw === null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new HttpError(400, `'${name}' must be a number, got '${raw}'.`);
  return n;
}

export function createAurealServer(options = {}) {
  const startTime = Date.now();

  const server = createServer(async (req, res) => {
    // CORS preflight
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": CORS_ALLOW_HEADERS
      });
      return res.end();
    }

    const parsed = new URL(req.url, "http://localhost");
    const pathname = parsed.pathname || "/";
    const query = Object.fromEntries(parsed.searchParams.entries());

    try {
      // 1. Health Probe
      if (req.method === "GET" && pathname === "/v1/health") {
        return sendJson(res, 200, {
          status: "ok",
          service: "aureal-watermark-microservice",
          version: "0.2.7",
          uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
          dsp: "active",
          ffmpeg: hasFfmpeg()
        });
      }

      // 2. API Root Info
      if (req.method === "GET" && pathname === "/") {
        return sendJson(res, 200, {
          name: "Aureal Watermark Microservice",
          version: "0.2.7",
          endpoints: {
            "GET /v1/health": "Health and readiness probe",
            "POST /v1/embed": "Embed acoustic watermark (Accepts binary audio or JSON)",
            "POST /v1/detect": "Detect and extract watermark (Accepts binary audio or JSON)"
          },
          documentation: "https://aureal.kellersystems.dev"
        });
      }

      // 3. POST /v1/embed
      if (req.method === "POST" && pathname === "/v1/embed") {
        const rawBody = await readRequestBody(req);
        const contentType = req.headers["content-type"] || "";

        let audioBytes = rawBody;
        let payloadId = query.id ? Number(query.id) : (req.headers["x-aureal-payload-id"] ? Number(req.headers["x-aureal-payload-id"]) : null);
        let key = query.key || req.headers["x-aureal-key"] || DEFAULT_KEY;
        let strength = query.strength ? Number(query.strength) : (req.headers["x-aureal-strength"] ? Number(req.headers["x-aureal-strength"]) : 0.5);
        let bandParam = query.band || req.headers["x-aureal-band"] || "dual";
        let outputFormat = query.format || req.headers["x-aureal-format"] || "wav";
        let isJsonMode = false;

        if (contentType.includes("application/json")) {
          isJsonMode = true;
          const json = parseJsonBody(rawBody);
          if (!json.audioBase64) {
            return sendJson(res, 400, { error: "Missing required 'audioBase64' in JSON payload." });
          }
          audioBytes = Buffer.from(String(json.audioBase64), "base64");
          if (json.id !== undefined) payloadId = Number(json.id);
          if (json.key !== undefined) key = String(json.key);
          if (json.strength !== undefined) strength = numberParam(json.strength, "strength");
          if (json.band !== undefined) bandParam = json.band;
          if (json.format !== undefined) outputFormat = json.format;
        }

        if (payloadId === null || !Number.isInteger(payloadId) || payloadId < 0 || payloadId > 0xFFFFFFFF) {
          return sendJson(res, 400, { error: "Query parameter, header, or JSON field 'id' must be an unsigned 32-bit integer (0..4294967295)." });
        }
        if (!Number.isFinite(strength)) {
          return sendJson(res, 400, { error: "'strength' must be a number between 0.01 and 1." });
        }
        const outFormat = normalizeOutputFormat(outputFormat);
        if (!outFormat) {
          return sendJson(res, 400, { error: `Unsupported output format. Use one of: ${OUTPUT_FORMATS.join(", ")}.` });
        }

        // Parse input to PCM
        let wav;
        try {
          wav = parseWav(audioBytes);
        } catch (err) {
          if (hasFfmpeg()) {
            wav = parseWav(transcodeToWavBuffer(audioBytes));
          } else {
            throw new HttpError(400, `Audio input could not be parsed: ${err.message}`);
          }
        }

        const band = parseBandParam(bandParam);
        const markedSamples = embedWatermark(wav.samples, { sampleRate: wav.sampleRate, channels: wav.channels }, {
          payloadId,
          key,
          strength,
          band
        });

        const markedWavBuffer = writeWav(markedSamples, {
          sampleRate: wav.sampleRate,
          channels: wav.channels,
          bitDepth: wav.bitsPerSample === 24 ? 24 : wav.bitsPerSample === 32 ? 32 : 16
        });

        const { buffer: finalBuffer, contentType: outContentType } = transcodeFromWavBuffer(markedWavBuffer, outFormat);

        if (isJsonMode) {
          return sendJson(res, 200, {
            success: true,
            payloadId,
            format: outFormat,
            durationSec: wav.durationSec,
            sampleRate: wav.sampleRate,
            channels: wav.channels,
            bitDepth: wav.bitsPerSample,
            audioBase64: finalBuffer.toString("base64"),
            metadata: markedSamples.watermarkMeta || null
          });
        }

        res.writeHead(200, {
          "Content-Type": outContentType,
          "Content-Length": finalBuffer.length,
          "X-Aureal-Payload-Id": String(payloadId),
          "X-Aureal-Duration-Sec": String(wav.durationSec.toFixed(2)),
          "X-Aureal-Band": typeof band === "string" ? band : `${band.lowHz}:${band.highHz}`,
          "Access-Control-Allow-Origin": "*"
        });
        return res.end(finalBuffer);
      }

      // 4. POST /v1/detect
      if (req.method === "POST" && pathname === "/v1/detect") {
        const rawBody = await readRequestBody(req);
        const contentType = req.headers["content-type"] || "";

        let audioBytes = rawBody;
        let expectedId = query.id ? Number(query.id) : (req.headers["x-aureal-payload-id"] ? Number(req.headers["x-aureal-payload-id"]) : null);
        let key = query.key || req.headers["x-aureal-key"] || DEFAULT_KEY;
        let bandParam = query.band || req.headers["x-aureal-band"] || "auto";
        let withReport = query.report === "true" || req.headers["x-aureal-report"] === "true";

        if (contentType.includes("application/json")) {
          const json = parseJsonBody(rawBody);
          if (!json.audioBase64) {
            return sendJson(res, 400, { error: "Missing required 'audioBase64' in JSON payload." });
          }
          audioBytes = Buffer.from(String(json.audioBase64), "base64");
          if (json.id !== undefined) expectedId = Number(json.id);
          if (json.key !== undefined) key = String(json.key);
          if (json.band !== undefined) bandParam = json.band;
          if (json.report !== undefined) withReport = Boolean(json.report);
        }

        if (expectedId !== null && (!Number.isInteger(expectedId) || expectedId < 0 || expectedId > 0xFFFFFFFF)) {
          return sendJson(res, 400, { error: "'id' must be an unsigned 32-bit integer (0..4294967295)." });
        }

        let wav;
        try {
          wav = parseWav(audioBytes);
        } catch (err) {
          if (hasFfmpeg()) {
            wav = parseWav(transcodeToWavBuffer(audioBytes));
          } else {
            throw new HttpError(400, `Audio input could not be parsed: ${err.message}`);
          }
        }

        const band = parseBandParam(bandParam);
        const detection = detectWatermark(wav.samples, { sampleRate: wav.sampleRate, channels: wav.channels }, {
          key,
          payloadId: expectedId !== null ? expectedId : undefined,
          band
        });

        const responseData = {
          fileFormat: wav.format,
          durationSec: wav.durationSec,
          sampleRate: wav.sampleRate,
          channels: wav.channels,
          ...detection
        };

        if (withReport) {
          const forensicReport = generateForensicReport({
            detectionResult: detection,
            audioBytes,
            audioMetadata: {
              durationSec: wav.durationSec,
              sampleRate: wav.sampleRate,
              channels: wav.channels,
              format: wav.format
            },
            expectedPayloadId: expectedId,
            secret: key
          });
          responseData.forensicReport = forensicReport;
          responseData.forensicCertificateText = formatForensicReportText(forensicReport);
        }

        return sendJson(res, 200, responseData);
      }

      // 404 handler
      return sendJson(res, 404, { error: `Endpoint not found: ${req.method} ${pathname}` });

    } catch (err) {
      const status = err instanceof HttpError
        ? err.status
        : err instanceof RangeError
          ? 400 // e.g. "audio too short for watermarking"
          : 500;
      if (!res.headersSent) return sendJson(res, status, { error: err.message || "Internal server error" });
      try { res.end(); } catch {}
    }
  });

  // The DSP runs synchronously on this thread, so a request can block the event loop for
  // seconds. Node's default 5 s keep-alive timeout then races a client that reuses the
  // connection and the socket is reset (ECONNRESET) before the queued request is served.
  // Give idle connections room for a blocked loop, and allow long uploads/processing.
  server.keepAliveTimeout = 120_000;
  server.headersTimeout = 125_000;
  server.requestTimeout = 600_000;

  return server;
}

// Start standalone daemon if executed directly
if (process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("docker/server.js")) {
  const port = Number(process.env.PORT) || 8080;
  const host = process.env.HOST || "0.0.0.0";
  const server = createAurealServer();

  server.listen(port, host, () => {
    console.log(`\n======================================================`);
    console.log(`  Aureal Watermark REST Microservice`);
    console.log(`  Version:     0.2.7 (Air-gapped ready)`);
    console.log(`  Listening:   http://${host}:${port}`);
    console.log(`  Healthcheck: http://${host}:${port}/v1/health`);
    console.log(`  FFmpeg:      ${hasFfmpeg() ? "Available (transcoding enabled)" : "Not found (WAV only)"}`);
    console.log(`======================================================\n`);
  });

  const shutdown = () => {
    console.log("Shutting down microservice daemon...");
    server.close(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
