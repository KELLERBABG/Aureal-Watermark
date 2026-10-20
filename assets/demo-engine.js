// assets/demo-engine.js — landing-page demo helpers.
//
// The watermark DSP itself is NOT implemented here: it comes from
// assets/aureal-engine.js, which scripts/build-engine.js generates from src/.
// This file only adds the demo's musical sample generator and the WAV/MP3 export
// helpers, and adapts the engine's result shape to what the landing page renders.

(function (global) {
  "use strict";

  function engine() {
    const E = global.AurealEngine;
    if (!E) throw new Error("Aureal engine not loaded (/assets/aureal-engine.js)");
    return E;
  }

  function bandKey(details) {
    const used = details && details.bandUsed;
    if (!used) return null;
    if (used.lowHz < 14000) return "mid";
    return "high";
  }

  function encodeWavArray(samples, sampleRate, channels, bitDepth = 16) {
    const bytesPerSample = bitDepth / 8;
    const frames = Math.floor(samples.length / channels);
    const dataLen = frames * channels * bytesPerSample;
    const padded = dataLen + (dataLen & 1);
    const buffer = new ArrayBuffer(44 + padded);
    const view = new DataView(buffer);

    view.setUint32(0, 0x52494646, false); // "RIFF"
    view.setUint32(4, 36 + padded, true);
    view.setUint32(8, 0x57415645, false); // "WAVE"
    view.setUint32(12, 0x666d7420, false); // "fmt "
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, channels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * channels * bytesPerSample, true);
    view.setUint16(32, channels * bytesPerSample, true);
    view.setUint16(34, bitDepth, true);
    view.setUint32(36, 0x64617461, false); // "data"
    view.setUint32(40, dataLen, true);

    const peak = bitDepth === 16 ? 32767 : 8388607;
    let offset = 44;
    for (let i = 0; i < samples.length; i++) {
      const s = Math.round(Math.max(-1, Math.min(1, samples[i])) * peak);
      if (bitDepth === 16) {
        view.setInt16(offset, s, true);
        offset += 2;
      } else {
        view.setUint8(offset, s & 0xff);
        view.setUint8(offset + 1, (s >> 8) & 0xff);
        view.setUint8(offset + 2, (s >> 16) & 0xff);
        offset += 3;
      }
    }
    return new Uint8Array(buffer);
  }

  function encodeWavBlob(samples, sampleRate, channels, bitDepth = 16) {
    const arr = encodeWavArray(samples, sampleRate, channels, bitDepth);
    return new Blob([arr], { type: "audio/wav" });
  }

  function encodeMp3Blob(samples, sampleRate, channels, kbps = 320) {
    const lame = typeof lamejs !== "undefined" ? lamejs : (typeof window !== "undefined" ? window.lamejs : null);
    if (!lame || !lame.Mp3Encoder) {
      throw new Error("MP3 encoder (lamejs) is not available. Please choose WAV format.");
    }
    const enc = new lame.Mp3Encoder(channels, sampleRate, kbps);
    const sampleCount = Math.floor(samples.length / channels);
    const left = new Int16Array(sampleCount);
    const right = channels >= 2 ? new Int16Array(sampleCount) : left;

    if (channels >= 2) {
      for (let i = 0; i < sampleCount; i++) {
        left[i] = Math.max(-32768, Math.min(32767, Math.round(samples[i * 2] * 32767)));
        right[i] = Math.max(-32768, Math.min(32767, Math.round(samples[i * 2 + 1] * 32767)));
      }
    } else {
      for (let i = 0; i < sampleCount; i++) {
        left[i] = Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767)));
      }
    }

    const chunks = [];
    const chunkSize = 1152;
    for (let i = 0; i < sampleCount; i += chunkSize) {
      const l = left.subarray(i, i + chunkSize);
      const r = channels >= 2 ? right.subarray(i, i + chunkSize) : l;
      const buf = channels >= 2 ? enc.encodeBuffer(l, r) : enc.encodeBuffer(l);
      if (buf && buf.length > 0) chunks.push(buf);
    }
    const end = enc.flush();
    if (end && end.length > 0) chunks.push(end);

    return new Blob(chunks, { type: "audio/mp3" });
  }

  function synthesizeSampleAudio(seconds = 5, sampleRate = 44100) {
    const totalFrames = Math.round(seconds * sampleRate);
    const pcm = new Float32Array(totalFrames * 2); // stereo
    const notes = [220, 261.63, 329.63, 392.00, 440, 523.25]; // Am chord arpeggio
    const noteDur = sampleRate * 0.65;

    for (let i = 0; i < totalFrames; i++) {
      const t = i / sampleRate;
      const noteIdx = Math.floor(i / noteDur) % notes.length;
      const f0 = notes[noteIdx];
      const noteT = (i % noteDur) / sampleRate;
      const env = Math.exp(-noteT * 2.8) * (1 - Math.exp(-noteT * 60));

      // Rich harmonic acoustic overtones (warm fundamental + natural air)
      const h1 = Math.sin(2 * Math.PI * f0 * t);
      const h2 = Math.sin(2 * Math.PI * f0 * 2 * t);
      const h3 = Math.sin(2 * Math.PI * f0 * 3 * t);
      const h4 = Math.sin(2 * Math.PI * f0 * 4 * t);
      const h5 = Math.sin(2 * Math.PI * f0 * 5 * t);
      const h6 = Math.sin(2 * Math.PI * f0 * 6 * t);

      // Symmetrically balanced stereo spread (centered phantom image, 0.0 dB ILD)
      const sL = (0.52 * h1 + 0.26 * h2 + 0.15 * h3 + 0.07 * h4 + 0.04 * h5 + 0.02 * h6) * env * 0.72;
      const sR = (0.52 * h1 + 0.25 * h2 + 0.16 * h3 + 0.07 * h4 + 0.04 * h5 + 0.02 * h6) * env * 0.72;

      pcm[i * 2] = sL;     // Left
      pcm[i * 2 + 1] = sR; // Right
    }
    return { pcm, sampleRate, channels: 2 };
  }

  global.AurealDemo = {
    synthesizeSample: synthesizeSampleAudio,
    embedWatermark: function (pcm, fmt, opts) {
      return engine().embedWatermark(pcm, { sampleRate: fmt.sampleRate, channels: fmt.channels }, opts);
    },
    detectWatermark: function (pcm, fmt, opts) {
      const r = engine().detectWatermark(
        pcm,
        { sampleRate: fmt.sampleRate, channels: fmt.channels },
        { ...opts, band: opts.band ?? "auto" }
      );
      return {
        detected: r.detected,
        confidence: r.confidence,
        ber: r.ber,
        ebN0Db: r.ebN0Db,
        sqnrDb: r.sqnrDb,
        recoveredPayloadId: r.recoveredPayloadId,
        crcOk: r.crcOk,
        reps: r.reps,
        bandUsed: bandKey(r.details),
        details: r.details,
      };
    },
    encodeWavArray: encodeWavArray,
    encodeWavBlob: encodeWavBlob,
    encodeMp3Blob: encodeMp3Blob,
    defaultKey: (global.AurealEngine && global.AurealEngine.DEFAULT_KEY) || "aural-watermark-default-key",
  };
})(typeof window !== "undefined" ? window : globalThis);
