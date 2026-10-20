# Aureal Watermark — independent test & audit

> **Status: remediated.** The findings below describe the code as audited. Fixes for all Critical/High findings except the wire-format item (F15) and the pricing-model decision (F19) have since been implemented, verified, and covered by a new `node --test` suite. See [§9 Resolution log](#9-resolution-log) at the end for what changed per finding. Sections 2–7 are the original evidence and are intentionally left in their "before" state.

**Audited commit:** `4aa2033` (`chore(legal): link directly to central Keller Systems portal legal portions`), working tree clean at start of audit.
**Version under test:** `0.2.7` (package.json, `ENGINE_VERSION`, CLI help, REST `/v1/health` all agree).
**Auditor environment:** Windows, Node.js `v24.14.1`, ffmpeg `9.0.2` (static build added to PATH by the auditor — the repository ships none), Docker CLI present but **no Docker daemon**, no `node_modules` (the project has no dependencies).

---

## 1. Method

Everything was exercised, not just read:

| Layer | How it was tested |
| :--- | :--- |
| DSP core (`src/*.js`) | Programmatic matrices: 5 signal types × mono/stereo × 9 sample rates × 8 payload-identity extremes × strength/band sweeps, plus ~200 randomised negative controls |
| WAV I/O | Bit-depth round-trips (8/16/24/32/EXTENSIBLE), malformed/truncated/MP3 inputs |
| CLI (`bin/auralwatermark.js`) | Every subcommand, every documented flag, exit codes, error paths, formats, forensic reports, JSON output |
| Standalone bundle | `scripts/bundle.js` → `dist/cli.cjs`, then the real Windows SEA executable built with `node --experimental-sea-config` + `postject` |
| REST service | `docker/server.js` spawned directly (daemon unavailable), 32 assertions across health/embed/detect/JSON/headers/formats/errors, with and without ffmpeg |
| Codec claims | 19 real ffmpeg transcodes incl. the documented multi-generation chain |
| Adversarial claims | 30 transforms from the README table (reverb, clipping, limiting, M/S, crops, LPF, SRC, …) |
| Browser engines | Inline engine extracted from `site/studio.html` / `site/verifier.html` and run in Node against the core engine (18 interop combinations) |
| Site/HTML | Link/asset resolution against `_redirects`, inline-script parse check, JS↔DOM id binding, pricing/claim cross-check |
| Security | Command-injection PoC against the REST `format` parameter, path handling, licence flow |

Reproduction scripts live in [`audit/`](audit/README.md). They are plain ESM scripts, not `node --test` files, so they do not change CI behaviour.

**Not verified (stated as limits):** Docker image build/compose (no daemon); the two live Polar checkout URLs (not fetched/paid); anything requiring the vendor's private corpus (the README's "local fixtures" are not in the repository).

---

## 2. Verdict in one table

| Promised capability | Result | Notes |
| :--- | :--- | :--- |
| Embed/detect round-trip (API + CLI) | **Works** | 100 % on normal material, 0 false positives observed across ~140 negative controls |
| 32-bit payload, CRC-16, blind detection | **Works** | CRC-16/CCITT-FALSE verified against the standard vector |
| WAV 8/16/24/32-bit + float, stereo/multichannel | **Works** | 1–8 channels; ≥ 0.1 s audio |
| MP3/FLAC/AAC/M4A/OGG/AIFF/Opus (CLI) | **Works** | via ffmpeg; all 7 formats round-trip |
| Lossy resilience (MP3 128 k, multi-gen chain) | **Works** | 16/19 transcodes; MP3 32 k, Opus 16 k, 8 kHz telephony fail (not promised) |
| Adversarial table (README) | **Mostly works** | Every row reproduces except the low-pass row (wrong in both directions) and the 1.8 s crop (≈53 % of offsets), plus the Tardos row (F3). See F16–F18 |
| Forensic audit report | **Broken promise** | HTML seal protects nothing and reports can be forged undetectably (F2) |
| Tardos anti-collusion accuser | **Not implemented** | Paid-tier feature does nothing; collusion defeats detection (F3) |
| Batch distribute + one-click leak audit | **Broken by default** | Manifest omits the key, so the audit tool cannot read its own output (F9) |
| Web Studio (browser) | **Works** | High/dual band; mid band is not interoperable with the CLI (F5) |
| Verifier page | **Works but unreachable** | No inbound link anywhere on the site (F23) |
| Desktop Studio / `.exe` | **Partially broken** | Builds and runs, but MP3 export and licence state are broken offline (F6–F8) |
| Commercial licence (Polar) | **Validation works** | Live API reachable; but the licence gates nothing and is ignored by the shipped exe |
| REST microservice | **Works — but remotely exploitable** | Unauthenticated RCE via the `format` parameter (F1) |
| CI test suite | **Vacuous** | `node --test` runs 0 tests and exits 0 (F10) |
| TypeScript definitions | **Wrong** | Signatures that do not exist at runtime (F14) |
| Website | **Mostly coherent** | Pricing contradictions and corrupted markup (F21–F24) |

---

## 3. Critical findings

### F1 — Unauthenticated remote command execution in the REST microservice  · `docker/server.js:54-91`
`transcodeFromWavBuffer()` builds a shell string with the caller-controlled `format` value:

```js
const tempOut = join(tmpdir(), `aureal_srv_trans_${id}.${fmt}`);   // fmt comes from ?format=
execSync(`ffmpeg ${ffmpegArgs} "${tempOut}"`, { stdio: "pipe" });
```

`execSync` runs through `cmd.exe` (Windows) / `/bin/sh` (Linux), so a `"` in `format` breaks out of the quoting. **PoC executed against a locally spawned instance:**

```
POST /v1/embed?id=1234&format=mp3%22%20%26%20echo%20AUREAL_RCE_PROOF%20%3E%20aureal_rce_proof.txt%20%26%20rem%20%22
→ HTTP 500, and the file aureal_rce_proof.txt was created in the server's working directory
```

The endpoint is unauthenticated, CORS-open, and the README explicitly markets this container for "Kubernetes, AWS ECS, or Nomad". Treat as a critical vulnerability: anyone who can reach the port can run commands as the container user. Repro: [`audit/13-rest-rce-poc.mjs`](audit/13-rest-rce-poc.mjs).

**Fix:** validate `format` against an allow-list (`wav|mp3|flac|aac|m4a|ogg`) before use, and call `execFileSync(ffmpeg, [...])` with an argument array (no shell).

The same unsafe pattern (paths interpolated into `execSync`) exists in `bin/auralwatermark.js:192,240` and `scripts/audit_leak.js:52`. On Windows the payload is constrained (filenames cannot contain `"`), but on macOS/Linux, where `"` is legal in filenames, processing an attacker-supplied file name can execute commands.

### F2 — The forensic "HMAC integrity seal" does not protect the report  · `src/report.js:113-120`
```js
const canonicalPayload = JSON.stringify(report, Object.keys(report).sort());
```
An array as the second argument is a **property allow-list applied recursively**, so every nested object serialises as `{}`. The bytes actually signed are:

```json
{"audioProperties":{},"engine":{},"forensicMetrics":{},"generatedAt":"…","interpretation":{},"schemaVersion":"1.0.0","targetFile":{},"verification":{}}
```

Only `generatedAt` and `schemaVersion` are covered. Changing `verification.detected`, `recoveredPayloadId`, the SHA-256, or `targetFile.sizeBytes` leaves the seal **byte-identical**. Demonstrated: a report that honestly says `NO_WATERMARK_FOUND` was edited into `WATERMARK_ID_MATCH` with a payload ID and an all-zero SHA-256, and the seal still matched ([`audit/12-evidence.mjs`](audit/12-evidence.mjs)). `signature.verified` is hard-coded `false` and no verification function is exported, so the seal cannot be checked by a third party either — recomputing it from the saved JSON (with `signature` present) produces a different digest.

This matters because the product presents the artefact as evidence: `README.md` calls it "a cryptographically sealed forensic audit proof", the CLI option is `--report proof.json --report-txt cert.txt`, and the sample certificate in the README is headed *FORENSIC PROOF CERTIFICATE*. The README does disclaim that a match is not proof of authorship, but the seal itself is presented as a tamper-evidence mechanism and provides none. As implemented it is decorative.

**Fix:** build an explicit canonical object and `JSON.stringify` it (sorted keys, no replacer), sign `report` *without* the `signature` field, export `verifyForensicReport(report, secret)`.

### F3 — The Tardos anti-collusion accuser is not wired to the audio at all  · `scripts/batch_distribute.js:146-193`, `src/embed.js:29-33`, `src/tardos.js`
`batch_distribute.js` generates per-recipient Tardos codewords and stores them in the manifest, but `embedWatermark({payloadId})` embeds **only** `packCodeword(payloadId)`; the Tardos codeword never enters the signal (`embedWatermark` has no parameter for a custom codeword). `audit_leak.js` then scores those unrelated random codewords against the detector's soft payload symbols.

Measured: recipient Tardos codewords agree with their own payload codeword 17–30 of 48 bits (chance), all Tardos scores ≈ 0.01 against a threshold of 9.70, `isCollusion: false`, no accused. End-to-end, a realistic 3-recipient **average attack with random IDs defeats the watermark completely** (`detected: false`, `crcOk: false`), and `audit_leak.js` reports `NO WATERMARK DETECTED` and exits before any collusion analysis.

The README row *"Coalition Collusion Attack (2–5 Leakers Averaging Copies) — YES … Accuses and identifies participating colluders"* and the €29/mo tier's *"Tardos anti-collusion accuser (catches multi-recipient averaging attacks)"* are therefore false. Also `audit_leak.js:221` prints `tardosReport.meanScore`, a property `accuseCoalition` never returns (it returns `medianScore`).

**Fix:** either implement per-recipient fingerprint signalling (needs a symbol budget far above 48, a codeword injector in `embedWatermark`, and a detector that returns Tardos-domain soft symbols) or remove the feature and the claim.

---

## 4. High-severity findings

### F4 — The documented custom band option is silently ignored  · `src/signal.js:82-91`
```js
export function bandList(spec, sampleRate) {
  if (spec === "high") return [resolveBand("high", sampleRate)];
  if (spec === "mid")  return [resolveBand("mid", sampleRate)];
  return [resolveBand("high", sampleRate), resolveBand("mid", sampleRate)];  // everything else → dual
}
```
`resolveBand()` *does* support `{lowHz, highHz}` objects, but `bandList` never passes them through. The CLI help, `docs/USAGE.md`, `docs/ARCHITECTURE.md`, `docs/PAYLOAD-FORMAT.md` and `types/index.d.ts` all advertise `--band lowHz:highHz`.

```
$ auralwatermark embed in.wav out.wav --id 999 --band 12000:14000
embed: id=999 … -> out.wav
  band dual (high 17-19.5 kHz + mid 4.5-13.5 kHz), …      ← requested band ignored, no warning
```
**Fix:** `if (typeof spec === "object" && spec && "lowHz" in spec) return [resolveBand(spec, sampleRate)];`

### F5 — The Web Studio / Verifier run a *different* engine from the CLI, and mid-band is not interoperable  · `site/studio.html:866-882`, `site/verifier.html`, `assets/demo-engine.js`
Five divergent copies of the DSP engine exist:

| Copy | MAX_AMPLITUDE | MULTI_BAND_SCALE | mid weight | mid preset | side-channel / modulo folding / drift sweep |
| :--- | ---: | ---: | ---: | :--- | :--- |
| `src/` (CLI, API, Docker) | 0.0085 | 0.85 | 0.42 | 4500–13500 Hz | yes / yes / yes |
| `site/studio.html` + worker | 0.0075 | 0.70 | 0.22 | 8000–13000 Hz | no / no / no |
| `site/verifier.html` | 0.0240 | 0.70 | 0.65 | 8000–13000 Hz | no / no / no |
| `assets/demo-engine.js` | 0.0028 | 0.70 | 0.12 | 8000–13000 Hz | no / no / no |

Measured cross-compatibility (same 10 s stereo speech, same key/ID):

| Embedder | Detector | high | mid | dual |
| :--- | :--- | :--- | :--- | :--- |
| core (`src`) | studio | ✅ | **❌** | ✅ |
| studio | core | ✅ | **❌** | ✅ |

So a master protected by the CLI with `--band mid` is reported as *pristine* by the Web Studio, and vice versa. The same divergence also means "strength 0.5" produces a different watermark level in each product (peak delta 0.0076 vs 0.0044).

`docs/ARCHITECTURE.md:169` claims "One codebase, two runtimes … cannot drift". Repro: [`audit/09-browser-engines.mjs`](audit/09-browser-engines.mjs).

**Fix:** ship one engine; either import it as an ES module in the pages (both are pure, browser-safe) or generate the inline copies from `src/` in `scripts/`.

### F6 — The standalone bundle and the shipped `.exe` cannot read or write the licence  · `scripts/bundle.js:89`, `src/license.js:14-16`
The CJS header destructures `const { join, dirname } = require("node:path")` but `license.js` uses the `path` namespace (`path.join(...)`, `path.dirname(...)`). There is no `path` binding, so every licence path call throws `ReferenceError` — swallowed by the surrounding `try/catch`, which then warns and pretends nothing is licensed.

The real Windows executable was built (SEA + postject) and tested with a valid `~/.aureal/license.json`:

```
source CLI : Status: ACTIVE / Tier: Commercial Pro License (Active) / Customer: exe@example.com
built .exe : Status: COMMUNITY EVALUATION
```

The exe's `embed` output shows `[Community Evaluation]` for a paying customer. `license --remove` likewise reports "no active licence". **Fix:** `const path = require("node:path")` in the bundle header (or use `join`/`dirname` in `license.js`).

### F7 — Desktop Studio: MP3 export is broken offline  · `bin/auralwatermark.js:97-128`, `site/studio.html:767`
`adaptHtmlForOffline()` rewrites `href="/…"` but not `src="/…"`. The studio page loads its encoder as
```html
<script src="/assets/lame.min.js"></script>
```
The page is opened as `file:///…/Temp/studio.html`, so that resolves to `file:///C:/assets/lame.min.js` (the icon `src="/assets/icon.svg"` breaks the same way). `lamejs` is therefore undefined and the advertised offline MP3 export throws *"MP3 encoder (lamejs) is not available. Please choose WAV format."* — even though `writeEmbeddedIcons()` has just copied `lame.min.js` into `Temp/assets/`. WAV export is unaffected.

**Fix:** also rewrite `src="(/[^"]*)"` to the `base + path` / inert form, or reference `assets/…` relatively.

### F8 — Desktop Studio: a stored licence is injected but then ignored  · `bin/auralwatermark.js:320-326`, `site/studio.html:2146`
The launcher injects `window.__AUREAL_PRESEEDED_LICENSE__`, but `getClientLicense()` only accepts it when `…PRESEEDED_LICENSE__.key` is truthy — and `saveLocalLicense()` deliberately deletes `key` before writing. A licence activated through the CLI therefore always shows "Community Edition" in the Desktop Studio. **Fix:** drop the `.key` requirement (test for `displayKey`/`status`).

### F9 — The "one-click leak audit" cannot read its own batch manifest  · `scripts/batch_distribute.js:133-143`, `scripts/audit_leak.js:119`
`manifest` records master/band/strength/Tardos data but **not the watermark key**; `audit_leak.js` falls back to the default key. Every batch produced with `--key` is therefore unreadable by the audit tool:

```
$ node scripts/audit_leak.js "promos/master_[Carol].wav" --manifest promos/recipients.json
Status: NO WATERMARK DETECTED        (exit 1)
$ … --key promo-key
Status: WATERMARK VERIFIED / MATCH CONFIRMED: Carol        (exit 0)
```
**Fix:** store the key (or a key fingerprint + explicit key prompt) in the manifest, or refuse to run without `--key` when the manifest was produced with one.

### F10 — There is no test suite; CI is green because it runs nothing  · `package.json:13`, `.github/workflows/test.yml:32`
`node --test` discovers zero files:
```
ℹ tests 0   ℹ pass 0   ℹ fail 0   exit 0
```
`node --test test/cli.test.js` → *Could not find* (exit 1). The documented counts ("72 tests passed", "25/25 checks", "42 automated test matrices", "29+11+2 tests", references to `test/ui.test.js`) have no counterpart in the repository. Every regression above would have been caught by a suite that the project claims to have.

### F11 — The release workflow cannot build  · `scripts/stamp-icon.cjs:1`, `.github/workflows/release.yml:62`
`stamp-icon.cjs` does `require("rcedit")`, but `rcedit` is not a dependency (the project has none) and the workflow never installs it:
```
Error: Cannot find module 'rcedit'
```
The step runs *before* the SEA/postject steps, so a tagged release fails. The file is also **not valid UTF-8** (one non-UTF-8 byte), which Node silently replaces with U+FFFD. The rest of the chain works: I built the blob, injected it with `postject` and ran `aureal-watermark.exe --help`, `gen`, `embed`, `detect` successfully (subject to F6).

### F12 — Carrier bands collapse at low sample rates  · `src/signal.js:73-80`
`clampInt(highHz, lowHz + 100, sampleRate/2 - 100)` returns the *upper* bound when `lowHz + 100 > sampleRate/2 - 100`, so the high band silently degenerates to a single frequency:

| sample rate | resolved bands |
| ---: | :--- |
| 8000 | `3900–3900` **and** `3900–3900` (dual embed = one tone, doubled) |
| 11025 | `5412.5–5412.5` + `4500–5412.5` |
| 16000 | `7900–7900` + `4500–7900` |
| 22050 | `10925–10925` + `4500–10925` |
| 44100 | `17000–19500` + `4500–13500` ✅ |

At 8 kHz — a normal rate for speech/telephony pipelines — the "dual-band" watermark is a single ~3.9 kHz tone at the Nyquist clamp: wasteful, likely audible, and with no redundancy. Detection at 8 kHz is also much less reliable than at 44.1 k. **Fix:** clamp the *band* to a valid range and drop preset bands that fall outside it (or fall back to a single valid band), and reject impossible configurations instead of silently collapsing them.

### F13 — REST: 24-bit input is silently downgraded to 16-bit  · `docker/server.js:230-234`
```js
writeWav(markedSamples, { … bitDepth: wav.bitDepth || 16 });
```
`parseWav()` returns `bitsPerSample`, never `bitDepth`, so the expression is always `16`. Verified: 24-bit input → 16-bit output. `bin/auralwatermark.js` gets this right. **Fix:** `bitDepth: wav.bitsPerSample === 24 ? 24 : wav.bitsPerSample === 32 ? 32 : 16`.

### F14 — TypeScript definitions do not match the runtime  · `types/index.d.ts`
* `crc16(id: number)` — the implementation takes a byte array; calling it with a number returns `0xFFFF`.
* `unpackCodeword()` is typed to return `{id: number|null, valid: boolean, correctedBits?: number[]}`; it returns `{id: number, crcOk: boolean}`.
* `generateTardosCodebook` / `accuseCoalition` are exported but not declared.
* `PolarLicenseStatus`, `saveLocalLicense`'s return type, `WatermarkMetadata`, `DetectionResult` (declares a nonexistent `details.rawCorrelation`, omits `crcOk`, `reps`, `softSymbols`, `resampled`, …) all disagree with the implementation.
* Channel range documented as 1–64; `validateFmt` allows 1–8.

A TypeScript consumer following these types will not compile against the real API. No `tsc` run exists in CI to catch it.

### F15 — Detection can report the wrong carrier band  · `src/detect.js:297-318`
Every band reuses the *same* spreading sequence (`makeSymbolStream(key, "bit"+b)` is independent of the band), so the band hypotheses are not orthogonal. Any linear processing that rotates the carrier phase can flip a non-matching band from ~0 to a confident hit:

```
high-band-only watermark, unfiltered       → band:'mid' → z = -0.6   (correctly not detected)
same file after an 18 kHz low-pass         → band:'mid' → z = +79, confidence 1.00, detected
```
Consequence: the `carrierBand` field written into the forensic report (and reported by the CLI/Studio) can name a band that carries nothing. It also means band-scoped detection cannot be used to prove mid-band redundancy. Repro: [`audit/12-evidence.mjs`](audit/12-evidence.mjs) evidence 2.

---

## 5. Medium-severity findings

**F16 — The "Short snippet crop (1.8 s)" claim is ~53 % reliable.** Sweeping 1.8 s excerpts across a 12 s file: 49 pass / 44 fail (93 offsets). 1.0 s excerpts: 25/48. 0.5 s excerpts: 0/38 — anything shorter than one frame (~1 s at 44.1 kHz) can never decode because `deriveGeometry` shrinks the frame with the file and `foldRepetitions`'s modulo path demands full coverage. The release notes say "shorter or longer crops are not characterized" — but the 1.8 s figure is presented as a pass.

**F17 — The README low-pass row is not reproducible.** It states the 16 kHz fixture passed and 12/7 kHz failed. On a 12 s stereo speech fixture at default settings: 16 kHz **fails**, 12 kHz fails (matches), 7 kHz **succeeds** (contradicts). A high-band-only watermark survives even a 5 kHz low-pass in the digital domain (the residual is still the watermark and there is nothing else in that band to mask it), which makes the whole row fixture-dependent rather than a guarantee.

**F18 — The "Bit-Transparent (≤ −60 dBFS)" badge is false at default settings.** Measured watermark level at the documented default (strength 0.5, dual band): **−41.4 dBFS peak, −57.5 dBFS RMS**. At strength 0.25 it is −47.5 / −63.6 dBFS. `docs/TECHNICAL_SPECIFICATIONS.md` says −48.5…−55 dBFS and the whitepaper −51…−55 dBFS; three documents, three numbers, none matching the code.

**F19 — Same SKU, three prices.** The *same* Polar checkout link is sold as **€89/year** on `site/pricing.html:712,722` and as **$249 one-time perpetual** in `site/studio.html:855-856`; `site/docs.html:1210` and `site/legal/terms.html:317` repeat the $249. Tier 2 is €290/yr vs $499 perpetual. Three names are used for one tier ("Creator Studio", "Solo Creator", "Indie Studio"). A buyer cannot tell what they are buying, and the EULA lists two tiers ("Voice AI $4,900/yr", "Audio Forensics $1,499") that appear nowhere for sale.

**F20 — A real personal email address ships in the product page.** `site/studio.html:829` (original): `<strong id="modal-customer">p***@gmail.com</strong>` — a live personal address was hard-coded as the Desktop Studio's licence-modal placeholder. (Address redacted in this report; it was removed from the page as part of the remediation.)

**F21 — Corrupted `<select>` markup.** `site/studio.html:768` and `site/index.html:1379` contain a CSS/`data:` URI fragment pasted into the tag with `\"` escapes; HTML has no backslash escaping, so the attribute ends at the first `"`. In the studio page the whole `style` attribute is gone and stray attributes/`href` text are injected into the control; on the landing page the dropdown keeps `appearance:none` but loses its chevron.

**F22 — Pricing page accessibility/logic defects.** The billing toggle's `<label>` has no text (empty accessible name), has no visual state (no `:checked` rule, no thumb), and on first paint the cards say €89/year while the comparison table headers say €9/mo.

**F23 — `/verifier` is orphaned.** A 70 KB page with a redirect rule and zero inbound links from any page. `site/studio.html:782` renders a button labelled "Scan in Verifier →" that in fact stays on the page (switches to the local detect tab).

**F24 — Privacy page contradicts itself.** `site/legal/privacy.html:313` says the CLI, the exe and `/studio` "make no network requests"; line 309 of the same list says licence validation "is a separate optional network request to Polar.sh", and `site/studio.html:2288` performs exactly that request.

**F25 — Head metadata.** No `rel=canonical` on any page, no `og:url`, no Twitter card; `og:image` only on two pages and pointing at `raw.githubusercontent.com` instead of the self-hosted `/assets/banner.png`; `site/verifier.html` reuses the studio's `<title>`/description; no meta description on the three legal pages.

**F26 — Legal routing is lossy.** `_redirects:26` `/legal/* → https://kellersystems.dev/legal/` drops the sub-path, and nothing maps to the in-repo `site/legal/*.html`, which are linked from nowhere. The same destination is labelled "Terms of Service", "Commercial EULA" and "Terms of Sale" on different pages.

**F27 — The collision detector only warns, and misses CLI mid-band masters.** The pre-check runs on file drop, uses the studio engine (so it cannot see a `--band mid` CLI watermark, F5) and is advisory — the Embed button stays enabled, so it does not "prevent" over-tagging as the README states.

**F28 — Blind-mode BER is meaningless but is displayed.** `src/detect.js:231-234` sets `refBits = hard` when no expected ID is supplied, so every blind detection reports `ber = 0`. The Studio shows it as "Bit Error Rate" and the JSON exposes it.

**F29 — The Studio's 8 s worker timeout turns long files into a frozen tab.** `site/studio.html:1556` rejects after 8 s and then runs the same work on the main thread (which blocks the UI). Detection of a 10 s file already takes ~1 s; a 10-minute file will block for roughly a minute.

**F30 — REST error semantics.** Malformed JSON → `500` (should be 400); non-audio body → `500` (should be 415/400); audio shorter than one watermark frame → `500` (should be 400 with the "audio too short" message); oversized body → `500` (should be 413). No size limit is enforced before buffering, and the `X-Aureal-Report` header the server reads is missing from the CORS allow-list. Compressed input without ffmpeg returns 400 while compressed *output* without ffmpeg returns 500.

**F31 — Documentation drift (list).** Independent doc audit against the code found: mid band documented as 8–13 kHz/10.5 kHz (actual 4.5–13.5/9.0); amplitude constants 0.12/0.0075/×0.7/×0.22 (actual 0.0085/0.85/0.42); confidence divisor 4.0 in one doc vs 27 in code; detection threshold 0.5 in two docs vs 0.35 in code; "single-bit correction / multi-bit fails cleanly" vs 1-and-2-bit correction; "CRC32" vs CRC-16; engine version 0.2.5 in three shipped pages and 0.2.1 in two docs; references to a removed `demo/` tree; "WASM verifier" that does not exist; "tamper-proof recipients.json" (it is unsigned JSON); "unmarked audio … rejected with 0.0 % confidence" (measured 0.03–0.30); 96 kHz normalisation (only 44.1/48 are tried); `publish-release.js` exits 0 on failure; `build-all.ps1` hard-codes the version.

---

## 6. Low-severity findings

* `site/studio.html:1972` — mojibake `⚠ï¸` (the ⚠️ variation selector was read as Latin-1).
* Pricing pages skip `h2` (`h1` → `h3`), and the capability matrix title is a `<div>`.
* Eleven `target="_blank"` links lack `rel="noopener"`, including two internal `/pricing` links that open a new tab.
* "Free & open-source" is the wrong description for PolyForm Noncommercial 1.0.0 (source-available, not OSI-approved).
* Five `<label>` elements label nothing (no `for`, not wrapping the input).
* `package.json` still lists `"demo/"` in `files`; that directory no longer exists.
* `detect missing.wav` blames the *format* and suggests installing ffmpeg instead of saying the file does not exist.
* `gen --bits 32` is rejected even though `writeWav` supports 32-bit float.
* The CLI `--help` documents `--band lowHz:highHz`, which is ignored (F4).
* The C2PA demo prints "(HMAC-SHA256 VALID)" and "VERIFIED" unconditionally; its JUMBF box is not real JUMBF and the `did:key:` issuer is invented. It runs correctly and is labelled illustrative in the README.
* `scripts/publish-release.js` uses `main().catch(console.error)` — a failed publish exits 0.

---

## 7. What genuinely works (verified, not assumed)

* **Core watermarking is solid on normal material.** 100 % round-trip on speech, broadband and music-like material at 22.05–192 kHz mono/stereo; correct ID, confidence 1.000, BER 0.
* **No false positives.** 0 detections across 5 unmarked source types, 40 randomised unmarked files across six sample rates (verify *and* blind), 60 white-noise files, and all processed controls. The CRC + confidence gate behaves.
* **Payload/CRC.** 32+16 symbols, MSB-first, CRC-16/CCITT-FALSE verified against the standard check value; IDs 0 and 0xFFFFFFFF round-trip.
* **WAV I/O.** 8/16/24/32-bit int and IEEE-float (including `WAVE_FORMAT_EXTENSIBLE`), mono–multichannel, correct sample-accurate round-trips, clean rejection of truncated/compressed/garbage input.
* **Format support.** WAV, MP3 (320/192/128), FLAC, AAC, M4A, OGG/Vorbis, AIFF and Opus all embed and detect through the CLI.
* **Lossy resilience.** The documented chain `WAV → MP3 128k → AAC 96k → MP4 → MP3 64k → Opus 96k → WAV` recovers the ID (conf 0.63, via the mid band). MP3 128 k on a music-like source: conf 1.0.
* **Adversarial transforms that pass:** M/S subtraction (all delivery forms), phase-inversion downmix, stereo→mono, reverb, +12 dB clipping, 20:1 limiting, −20 dB pink noise, 1 kHz high-pass, 18 kHz notch, sample-rate conversion to 48/32/22.05/16/96 kHz, ±0.5 % and ±1.0 % speed drift, multi-layer watermarking with distinct keys, and re-embedding behaving as documented (not reliable).
* **CLI.** All subcommands and flags work; exit codes 0/1/2 are correct; `--json` is valid, complete JSON (48 soft symbols included); `--report`/`--report-txt` write both artefacts.
* **REST service.** Health/root/embed/detect, binary and JSON-base64 bodies, query/header parameters, MP3/FLAC/OGG output, forensic report in the response, CORS, 404s. Works with and without ffmpeg (degrading to WAV).
* **Polar licence validation.** Live API reachable; empty key and bogus key return correct, non-throwing errors; nothing but the key is transmitted.
* **Build.** `scripts/bundle.js` produces a working 400 KB standalone CJS; SEA + postject produces a working 91 MB `.exe` (gen/embed/detect verified).
* **Site hygiene.** Zero broken internal links/assets across 8 pages and 13 files, aliases byte-identical (`sync:site --check` clean), one `<h1>` per page, no duplicate ids, every `label[for]` resolves, every inline script parses, no leftover placeholders, demo certificate honestly labelled as illustrative.

---

## 8. Recommended order of work

1. **F1** (RCE) — patch and ship. Nothing else matters more for a service marketed for cloud deployment.
2. **F2, F3** (forensic seal, Tardos) — either make them real or remove the claims and the paid tier bullet. Both currently misrepresent what the product does.
3. **F10 + F11** (tests, release build) — a real suite (the scripts in `audit/` are a starting point) and a working release pipeline; everything else becomes regression-proof.
4. **F4, F5, F6, F7, F8, F9** — the "one product, five engines" cluster plus the licence/export plumbing. Consolidate the engine and the licensing path.
5. **F12, F13, F14, F15** — correctness of bands, bit depth, types, band reporting.
6. **F16–F31** — claim hygiene: make the README and site say what the code does (or change the code), then fix the site defects.

---

## 9. Resolution log

Everything was re-tested after the changes. `npm test` runs the new suite (69 tests, 0 failures, ~95 s, no dependencies, no ffmpeg needed).

| # | Finding | Status | What changed |
| :--- | :--- | :--- | :--- |
| F1 | REST command injection | **Fixed** | `format` validated against an allow-list (`normalizeOutputFormat`); every ffmpeg call is `execFileSync(program, args[])`; the CLI, `audit_leak.js` and the desktop opener no longer use a shell; ffmpeg timeouts added. The PoC now returns `400 Unsupported output format` and creates no file. REST suite 32/32. |
| F2 | Seal covers nothing / no verifier | **Fixed** | `generateForensicReport` signs a deep-sorted canonical serialisation of the whole body; `verifyForensicReport()` exported; new `auralwatermark verify-report <file> --key …` (exit 0/1); schema bumped to 1.1.0 and legacy seals are explicitly rejected. Tampering with any of 10 fields is now detected (14/14 checks). |
| F3 | Tardos anti-collusion not implemented | **Fixed (claims removed)** | `batch_distribute.js` no longer fabricates Tardos codewords; `audit_leak.js` no longer pretends to accuse (and the `meanScore` crash is gone); `src/tardos.js` is documented as a standalone scorer with no signalling channel; README, pricing page, docs and the commercial-licensing page now state collusion as a known limitation. |
| F4 | Custom band silently ignored | **Fixed** | `bandList()` honours `{lowHz, highHz}`, clamps it, and throws a clear `RangeError` when it cannot fit; the CLI prints the real band instead of always "dual". Verified through the API and the CLI. |
| F5 | Five divergent engines | **Fixed** | New `scripts/build-engine.js` generates `assets/aureal-engine.js` from `src/`; the Studio, Verifier and landing demo load it and keep only a thin adapter (plus the demo synth/encoders). `sync:site:check` fails on drift and CI runs it. Studio embed is now **bit-identical** to the core; 12/12 interop combinations detect, including mid-band. |
| F6 | Bundle `.cjs`/`.exe` licence broken | **Fixed** | `const path = require("node:path")` added to the generated CJS header; the built `.exe` now reports `ACTIVE` and shows `[Commercial Pro: …]` with a stored licence. |
| F7 | Desktop MP3 export broken | **Fixed** | `adaptHtmlForOffline()` also rewrites `src="/assets/…"` to the local `assets/` directory; the launcher and the bundle both write `assets/aureal-engine.js` + `assets/lame.min.js` next to the page. |
| F8 | Preseeded licence ignored | **Fixed** | `getClientLicense()` accepts the injected record on its status/display fields instead of requiring a stripped `key`. |
| F9 | Leak audit cannot read its own manifest | **Fixed** | `batch_distribute.js` records `key`/`keyDefault` (and documents that the manifest is private); `audit_leak.js` therefore traces a leaked copy without `--key`. |
| F10 | No tests, vacuous CI | **Fixed** | `test/` with 69 `node --test` cases covering payload/CRC, WAV I/O, watermark round-trip + bands, report seal, CLI, REST, browser engine and distribution scripts. `node --test` now reports 69 pass. |
| F11 | Release build cannot complete | **Fixed** | `stamp-icon.cjs` is valid UTF-8, degrades to a warning when `rcedit` is absent, and `rcedit` is a declared devDependency installed by the release workflow. |
| F12 | Bands collapse at low sample rates | **Fixed** | `resolveBand`/`bandList` never return degenerate or duplicate bands; presets that do not fit are dropped (dual) or replaced by a wide fallback band (single); impossible custom bands throw. 8 kHz now yields `2145–3900` and round-trips. |
| F13 | REST drops 24-bit to 16-bit | **Fixed** | Uses `wav.bitsPerSample` (16/24/32) instead of the nonexistent `wav.bitDepth`. |
| F14 | TypeScript definitions wrong | **Fixed** | `types/index.d.ts` rewritten against the runtime; verified with `tsc --strict` on a harness that exercises every export (0 errors) plus 88 runtime shape assertions. Negative control on the old file: 46 errors. |
| F15 | Wrong carrier band reported | **Deferred (documented)** | The root cause is that all bands reuse one spreading sequence, so fixing it changes the wire format and invalidates existing watermarks. Recorded as a limitation in README, TECHNICAL_SPECIFICATIONS, WHITEPAPER, COMMERCIAL_LICENSING and the report text; `carrierBand` is presented as informational. |
| F16 | 1.8 s crop ≈53 % | **Fixed (claim)** | README, release notes, whitepaper and technical spec now state the measured behaviour instead of "passed". |
| F17 | Low-pass row not reproducible | **Fixed (claim)** | Row rewritten with the measured, fixture-dependent result. |
| F18 | "≤ −60 dBFS" badge | **Fixed (claim)** | Badge now says "≈ −57 dBFS RMS (default)"; docs quote measured peak/RMS and state that `amp` is not a peak bound. |
| F19 | Same SKU, three prices | **Deferred (owner decision)** | The Studio's "$249" CTA on the same Polar URL as the €89/yr plan was replaced with a neutral link to `/pricing`. **The remaining €89/yr vs $249 and €290/yr vs $499 contradiction between `pricing.html`, `docs.html` and `legal/terms.html` needs a commercial decision — it was not invented here.** |
| F20 | Personal email in shipped page | **Fixed** | Placeholder removed from `studio.html`. |
| F21 | Corrupted `<select>` markup | **Fixed** | Studio select rebuilt to the CSS-driven version; landing-page select rebuilt with a fully percent-encoded data URI. Checked by `audit/14-site-markup.mjs` (39/39). |
| F22 | Pricing toggle a11y/state | **Fixed** | Accessible name, real thumb with `:checked`/`:focus-visible` styling (reduced-motion aware), matrix headers driven by the toggle, matrix title is now an `h2`. |
| F23 | `/verifier` orphaned | **Fixed** | Footer links added on every page; the Studio button now says "Scan this export" (which is what it does). |
| F24 | Privacy page self-contradiction | **Fixed** | The bullet now names the single optional Polar request. |
| F25 | Head metadata | **Fixed** | `rel=canonical` and `og:url` on all five pages, self-hosted `og:image`, unique verifier title, mojibake repaired. |
| F26 | Legal routing | **Deferred** | `/legal/*` points at the central Keller Systems portal; the in-repo copies are duplicates of it. Changing the mapping is a legal/copy decision. |
| F27 | Collision detector wording | **Fixed** | README describes it as an advisory pre-check that cannot see a different key. |
| F28 | Blind-mode BER always 0 | **Fixed (documented)** | Documented in the types and docs; the metric remains shown in the Studio (cosmetic follow-up). |
| F29 | 8 s worker timeout freezes tab | **Fixed** | The timeout is gone; the worker is built from the fetched engine source and falls back to the main thread only when a worker is unavailable. |
| F30 | REST error semantics | **Fixed** | 400 for bad JSON/params/too-short audio, 415 for undecodable input, 413 for oversized bodies (checked from `Content-Length` and while streaming), 501 when ffmpeg is needed but absent, 404 unchanged; `X-Aureal-Report` added to CORS. |
| F31 | Docs drift | **Fixed** | All eight `docs/*.md` files corrected against the code (bands, amplitudes, thresholds, error correction, CRC, versions, paths, test counts, Tardos, tamper-proof manifest, WASM) and given explicit limitation sections. |

**Re-verified after the fixes:** the REST suite is 32/32, the browser-engine suite 25/25, the WAV/band suite 21/21, the desktop-offline suite 18/18, the site-markup suite 39/39, the report-seal suite 14/14, and the full `npm test` suite is 69/69 green. The SEA executable was rebuilt and passes `--help`, `gen`, `embed`, `detect` and licence status.

**Real-browser end-to-end (`audit/15-browser-e2e.mjs`, 18/18).** The exact payload the launcher writes was loaded in headless Edge over `file://`: the generated engine and the offline LAME encoder load from disk, embed→detect returns the ID at confidence 1.0, unmarked audio is not falsely detected, WAV export produces a RIFF file and MP3 export produces a valid MPEG stream (81 KB with a sync word), the rebuilt `<select>` has only an `id` attribute, and no page errors are raised. The repository was then served over HTTP and the Web Studio exercised at both `/site/studio.html` and the `/site/studio/index.html` alias: the engine loads, the DSP **Web Worker is constructed and actually used** for detection, and both URL shapes resolve the worker source (the worker now fetches the canonical `/assets/` path on http, and the relative path on `file://`).

**Platform matrix (actually executed, not inferred):**

| Platform | Suite | Artifact / extras |
| :--- | :--- | :--- |
| Windows 11, Node 24.14.1 | 69/69 | SEA `.exe` built (postject), `--help`/gen/embed/detect, stored licence → `ACTIVE`; 19 ffmpeg transcodes |
| Windows, Node 20.20.2 | 69/69 | CLI/REST/scripts all spawned through that Node |
| Windows, Node 18.20.8 | 69/69 | same |
| **Linux (Debian 13, WSL), Node 22.20.0** | **69/69** | **Linux SEA artifact built with postject and exercised** (`--help`, gen/embed/detect, stored licence → `ACTIVE`); CLI formats mp3/flac/m4a/ogg/opus/aiff on ffmpeg 7.1.5; REST `format=mp3` round-trip; both shell-injection payloads rejected with 400 and no side effects |
| macOS | **not executed** | no macOS host available; same bundle/CLI code, but the `postject --macho-segment-name` + `codesign` steps are reviewed only |
| Docker image | **not built** | no daemon; the server itself is proven under Linux, and the Dockerfile only adds `apk add ffmpeg`, a non-root user and tmpfs |

Remaining unexecuted areas after this pass: the macOS SEA build, the Docker **image** build, and the GitHub-hosted runners themselves. Everything else in the table above was run.

**Still open (needs the owner):** F19 pricing/currency model, F26 legal-page routing, and the F15 wire-format decision. **Not executed:** the macOS SEA build and Docker image build (see the platform matrix above); the GitHub-hosted runners themselves.

---

*Scripts: [`audit/README.md`](audit/README.md). Sections 2–7 record the code as audited, before remediation.*
