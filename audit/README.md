# Aureal Watermark — audit scripts

These scripts produced the evidence in [`../AUDIT_REPORT.md`](../AUDIT_REPORT.md). They are plain ESM programs, not `node --test` files, so they do not alter what CI runs. Run them from the repository root.

> **After remediation**, the repository's first-line regression suite is `npm test` (`test/*.test.js`). These scripts remain the deeper measurement tools: adversarial transforms, codec chains, crop/offset sweeps and the injection PoC. Several of them encode the *product-ideal* expectation for a row (for example "a 1.8 s crop is recovered"), so they still print `FAIL` where the documented limitation is now known and reported — read those as measurements, not as regressions. The contract-level checks that must stay green are in `test/`.

```bash
node audit/01-core-api.mjs
```

Some scripts need extra environment:

| Script | Needs |
| :--- | :--- |
| `07-codec-resilience.mjs` | `AUREAL_FFMPEG` = absolute path to `ffmpeg`, `AUREAL_WORK` = scratch dir |
| `10-wav-and-validation.mjs` | `AUREAL_MP3` = path to any MP3 file (for the reject test) |
| `08-rest-service.mjs`, `13-rest-rce-poc.mjs` | `ffmpeg` on `PATH` for the transcode paths |
| `13-rest-rce-poc.mjs` | nothing extra — it spawns `docker/server.js` itself |
| `15-browser-e2e.mjs` | Chrome or Edge (auto-detected; override with `AUREAL_BROWSER`). No package install: it drives the browser over the DevTools protocol using Node's built-in `WebSocket`. |

Everything is written to `%TEMP%` (or `$TMPDIR`); the scripts do not touch the repository. `13-rest-rce-poc.mjs` deliberately exercises the command-injection path, but only ever creates a harmless marker file inside a scratch directory.

| Script | Covers |
| :--- | :--- |
| `01-core-api.mjs` | embed/detect matrix: 5 signal types, mono/stereo/3–8 ch, 8 sample rates, identity extremes, key isolation, strength/band sweeps, minimum duration, silence, input validation |
| `02-forensic-report.mjs` | report generation, seal reproducibility (library vs third party), tamper detection, wrong secret |
| `03-tardos-collusion.mjs` | takes `<wav> <recipients.json> <key>`; feed it a collusion fixture built with `lib-average-wavs.mjs` after running `scripts/batch_distribute.js` |
| `04-adversarial-claims.mjs` | one check per row of the README "Operational Capabilities & Adversarial Attack Resistance" table |
| `05-bands-and-crops.mjs` | per-band detection behaviour, low-pass sweep, crop-offset sweeps at 1.8 s / 1.0 s / 0.5 s |
| `06-false-positives.mjs` | negative controls: clean sources, 40 randomised unmarked files (verify + blind), white noise, processed audio |
| `07-codec-resilience.mjs` | 19 real ffmpeg transcodes including the documented multi-generation chain and platform-style pipelines |
| `08-rest-service.mjs` | 32 assertions over the REST microservice (health, embed, detect, JSON/base64, headers, formats, errors, CORS) |
| `09-browser-engines.mjs` | syntax-checks every inline script, then cross-tests the studio/verifier engines against `src/` in 18 combinations |
| `10-wav-and-validation.mjs` | WAV codecs and malformed input, CRC vector, payload round-trip, custom-band and sample-rate band resolution |
| `11-desktop-offline.mjs` | evaluates the real `bin/auralwatermark.js` helpers and checks the `file://` link adaptation, inert-link marking and licence marker |
| `12-evidence.mjs` | focused, quotable evidence: forgeable report seal, wrong carrier band, band collapse, licence gating |
| `13-rest-rce-poc.mjs` | command-injection PoC against the `format` parameter of `/v1/embed` |
| `14-site-markup.mjs` | regression checks for the site defects: select markup, mojibake, labels, `rel`, canonical/og, pricing toggle and Tardos copy |
| `15-browser-e2e.mjs` | **real-browser end-to-end**: builds the exact desktop payload and loads it over `file://` (engine + LAME load, embed→detect, WAV/MP3 export, no page errors), then serves the repo over HTTP and drives the Web Studio in both the canonical route and the directory alias, including a detect that goes through the DSP Web Worker |
| `lib.mjs` | deterministic signal generators (speech-like, broadband, white/pink noise, sine, silence, SNR) |
| `lib-average-wavs.mjs` | averages N WAV files into one (collusion-attack simulation) |

Notes:

* `01` and `04` deliberately encode "expected" outcomes taken from the README; the printed `FAIL` lines are the audit's observations, not a pass/fail gate. After remediation, the outcomes that intentionally changed (custom bands, low-rate fallback) are documented limitations rather than regressions.
* Timing depends on audio length: `01`/`04`/`05`/`06` take a few minutes each because detection integrates every frame of every hypothesis.
* `12-evidence.mjs` expects an *empty* local licence store; it prints the licence state it finds.
* `15-browser-e2e.mjs` launches headless Chrome/Edge; it kills its own browser and cleans its temp profile on exit.
