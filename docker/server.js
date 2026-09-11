// docker/server.js — High-performance, zero-dependency HTTP REST Microservice for Aureal Watermark
import { createServer } from "node:http";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileSync, readFileSync, unlinkSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";

import { embedWatermark } from "../src/embed.js";
import { detectWatermark } from "../src/detect.js";
import { parseWav, writeWav, WavError } from "../src/wav.js";
import { generateForensicReport, formatForensicReportText } from "../src/report.js";
import { DEFAULT_BAND } from "../src/signal.js";

const DEFAULT_KEY = "aural-watermark-default-key";
const MAX_BODY_BYTES = (Number(process.env.MAX_BODY_SIZE_MB) || 100) * 1024 * 1024;

let cachedFfmpeg = null;
export function hasFfmpeg() {
  if (cachedFfmpeg !== null) return cachedFfmpeg;
  try {
    execSync("ffmpeg -version", { stdio: "ignore" });
    cachedFfmpeg = true;
  } catch {
    cachedFfmpeg = false;
  }
  return cachedFfmpeg;
}

/**
 * Transcode arbitrary audio buffer to in-memory 16-bit PCM WAV.
 */
export function transcodeToWavBuffer(inputBuffer, ext = ".audio") {
  if (!hasFfmpeg()) {
    throw new Error("FFmpeg is required to process compressed audio formats in this microservice.");
  }
  const id = randomBytes(8).toString("hex");
  const tempIn = join(tmpdir(), `aureal_srv_in_${id}${ext}`);
  const tempOut = join(tmpdir(), `aureal_srv_out_${id}.wav`);

  try {
    writeFileSync(tempIn, inputBuffer);
    execSync(`ffmpeg -y -v error -i "${tempIn}" -vn -acodec pcm_s16le "${tempOut}"`, { stdio: "pipe" });
    return readFileSync(tempOut);
  } finally {
    try { if (existsSync(tempIn)) unlinkSync(tempIn); } catch {}
    try { if (existsSync(tempOut)) unlinkSync(tempOut); } catch {}
  }
}

/**
 * Transcode WAV buffer to target compressed container (e.g. mp3, flac, aac).
 */
export function transcodeFromWavBuffer(wavBuffer, targetFormat = "wav") {
  const fmt = targetFormat.toLowerCase().replace(/^\./, "");
  if (fmt === "wav") return { buffer: wavBuffer, contentType: "audio/wav" };

  if (!hasFfmpeg()) {
    throw new Error(`FFmpeg is required to transcode output to '${fmt}'.`);
  }

  const id = randomBytes(8).toString("hex");
  const tempWav = join(tmpdir(), `aureal_srv_trans_${id}.wav`);
  const tempOut = join(tmpdir(), `aureal_srv_trans_${id}.${fmt}`);

  try {
    writeFileSync(tempWav, wavBuffer);
    let ffmpegArgs = `-y -v error -i "${tempWav}" -vn`;
    let contentType = "application/octet-stream";

    if (fmt === "mp3") {
      ffmpegArgs += " -c:a libmp3lame -b:a 320k";
      contentType = "audio/mpeg";
    } else if (fmt === "flac") {
      ffmpegArgs += " -c:a flac";
      contentType = "audio/flac";
    } else if (fmt === "aac" || fmt === "m4a") {
      ffmpegArgs += " -c:a aac -b:a 256k";
      contentType = fmt === "aac" ? "audio/aac" : "audio/mp4";
    } else if (fmt === "ogg") {
      ffmpegArgs += " -c:a libvorbis -q:a 7";
      contentType = "audio/ogg";
    }

    execSync(`ffmpeg ${ffmpegArgs} "${tempOut}"`, { stdio: "pipe" });
    return { buffer: readFileSync(tempOut), contentType };
  } finally {
    try { if (existsSync(tempWav)) unlinkSync(tempWav); } catch {}
    try { if (existsSync(tempOut)) unlinkSync(tempOut); } catch {}
  }
}

function parseBandParam(band) {
  if (!band) return "dual";
  if (band === "high" || band === "mid" || band === "dual" || band === "auto") return band;
  const parts = String(band).split(":").map(Number);
  if (parts.length === 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1])) {
    return { lowHz: parts[0], highHz: parts[1] };
  }
  return "dual";
}

function sendJson(res, statusCode, data) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Aureal-Payload-Id, X-Aureal-Key, X-Aureal-Strength, X-Aureal-Band, X-Aureal-Format"
  });
  res.end(body);
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    req.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        reject(new Error(`Payload exceeds maximum size of ${MAX_BODY_BYTES / (1024 * 1024)}MB`));
      } else {
        chunks.push(chunk);
      }
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export function createAurealServer(options = {}) {
  const startTime = Date.now();

  const server = createServer(async (req, res) => {
    // CORS preflight
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Aureal-Payload-Id, X-Aureal-Key, X-Aureal-Strength, X-Aureal-Band, X-Aureal-Format"
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
          version: "0.2.4",
          uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
          dsp: "active",
          ffmpeg: hasFfmpeg()
        });
      }

      // 2. API Root Info
      if (req.method === "GET" && pathname === "/") {
        return sendJson(res, 200, {
          name: "Aureal Watermark Microservice",
          version: "0.2.4",
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
          const json = JSON.parse(rawBody.toString("utf8"));
          if (!json.audioBase64) {
            return sendJson(res, 400, { error: "Missing required 'audioBase64' in JSON payload." });
          }
          audioBytes = Buffer.from(json.audioBase64, "base64");
          if (json.id !== undefined) payloadId = Number(json.id);
          if (json.key !== undefined) key = json.key;
          if (json.strength !== undefined) strength = Number(json.strength);
          if (json.band !== undefined) bandParam = json.band;
          if (json.format !== undefined) outputFormat = json.format;
        }

        if (payloadId === null || !Number.isInteger(payloadId) || payloadId < 0 || payloadId > 0xFFFFFFFF) {
          return sendJson(res, 400, { error: "Query parameter, header, or JSON field 'id' must be an unsigned 32-bit integer (0..4294967295)." });
        }

        // Parse input to PCM
        let wav;
        try {
          wav = parseWav(audioBytes);
        } catch (err) {
          // Fallback to FFmpeg transcoding
          if (hasFfmpeg()) {
            const wavBuf = transcodeToWavBuffer(audioBytes);
            wav = parseWav(wavBuf);
          } else {
            return sendJson(res, 400, { error: `Audio input could not be parsed: ${err.message}` });
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
          bitDepth: wav.bitDepth || 16
        });

        const { buffer: finalBuffer, contentType: outContentType } = transcodeFromWavBuffer(markedWavBuffer, outputFormat);

        if (isJsonMode) {
          return sendJson(res, 200, {
            success: true,
            payloadId,
            format: outputFormat,
            durationSec: wav.durationSec,
            sampleRate: wav.sampleRate,
            channels: wav.channels,
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
          const json = JSON.parse(rawBody.toString("utf8"));
          if (!json.audioBase64) {
            return sendJson(res, 400, { error: "Missing required 'audioBase64' in JSON payload." });
          }
          audioBytes = Buffer.from(json.audioBase64, "base64");
          if (json.id !== undefined) expectedId = Number(json.id);
          if (json.key !== undefined) key = json.key;
          if (json.band !== undefined) bandParam = json.band;
          if (json.report !== undefined) withReport = Boolean(json.report);
        }

        let wav;
        try {
          wav = parseWav(audioBytes);
        } catch (err) {
          if (hasFfmpeg()) {
            const wavBuf = transcodeToWavBuffer(audioBytes);
            wav = parseWav(wavBuf);
          } else {
            return sendJson(res, 400, { error: `Audio input could not be parsed: ${err.message}` });
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
      return sendJson(res, 500, { error: err.message || "Internal server error" });
    }
  });

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
    console.log(`  Version:     0.2.4 (Air-gapped ready)`);
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
