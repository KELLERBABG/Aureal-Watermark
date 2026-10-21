# Deferred work — read this before the next release

Written 2026-10-20, after the ground-up audit and remediation (see `AUDIT_REPORT.md`).
Everything the audit found that is *not* fixed is listed here, with the reason it was
deferred and what "done" looks like. Nothing here blocks running the software; some of it
blocks **selling** it.

Status of the code: `npm test` = 123 tests (121 pass, 2 ffmpeg-gated skips) on Windows
Node 18/20/24 and Linux Node 22 (measured at 69 tests before the verification branch was
merged; the suite has grown since). Browser Studio verified in headless Edge for both
`file://` (desktop) and HTTP (web) with the real engine + MP3 encoder. See
`AUDIT_REPORT.md` §9 for the resolution log.

---

## 1. Closed-source migration (blocker for taking money)

The repository is going private. That breaks the current distribution path:

- [ ] **Host the binaries somewhere public.** Release assets on a private GitHub repo
      require auth, so anonymous browser downloads 404. `README.md` links to
      `releases/latest/download/aureal-watermark.exe` and `...cjs` — both will break.
      Cloudflare **Pages cannot host them**: max 25 MiB per file
      (https://developers.cloudflare.com/pages/platform/limits/), while the SEA
      executables are ~87 MiB (Windows) and ~118 MiB (Linux). Options:
      public R2 bucket (`static.aureal…`), a separate public binaries-only repo, or
      another CDN. The universal ZIP (~1 MB) *can* stay on Pages.
- [ ] **Make the download base configurable.** Put it in one place (e.g. a constant in the
      site build or an env var) instead of hard-coding links per page.
- [ ] **Replace the repo links that will 404.** ~15 places: footers of
      `site/{index,docs,pricing,studio,verifier}.html` + their `site/*/index.html`
      aliases, the docs "GitHub" links, and the footer `LICENSE.md` link (points at a
      GitHub blob). Point them at site-internal pages or nothing.
- [ ] **`package.json`**: `repository`, `homepage`, `bugs` all point at the private repo.
      Repoint at the website, or drop them.
- [ ] **npm publish decision.** `"files"` still ships `src/` and `"main": "src/index.js"`,
      so publishing the package hands over the source. Either don't publish, publish a
      bundled `dist/`, or accept source-available for the JS API.
- [ ] **Licence wording.** The site currently says "source-available, not OSI open source";
      with a private repo that no longer applies. Decide the binary terms (PolyForm NC for
      personal/academic + commercial licence for monetised use), publish it as a site page,
      and make the footer link point there instead of GitHub.

**Reality check, plan for it:** closing the repo does not make the algorithm secret. The
Web Studio serves `assets/aureal-engine.js` in readable JS to every visitor, and the
`.cjs`/`.exe` embed the same plain JS (extractable from the SEA blob). Closed source
protects the codebase and history, not the DSP.

---

## 2. Before announcing / taking money

- [ ] **Run the release workflow once** (`workflow_dispatch` on a pre-release tag). The
      Windows and Linux SEA steps were reproduced by hand and work; the workflow itself has
      never executed. This is a launch-day fire otherwise.
- [ ] **macOS artifact**: never built or run (no macOS host). Either test it or don't
      publish a macOS download. The `postject --macho-segment-name` + `codesign` steps are
      reviewed only.
- [ ] **Docker image**: never built (no daemon). The server itself is proven under Linux.
      Build it once and run `docker compose -f docker/docker-compose.yml up -d` + the curl
      examples, or soften the "deploy in 1 command" claim for the Platform tier.
- [ ] **Seal default secret.** A report generated without `--key` is sealed with a public
      constant, so an opposing party can regenerate the seal. Recommended: add
      `signature.keyProtection: "user-supplied" | "public-default"` and print a warning in
      the text certificate when the default is used. (`src/report.js`,
      `formatForensicReportText`.)

---

## 3. Product residuals — safe to fix when a customer reports it

- [ ] **Locale formatting** in the text certificate: `targetFile.sizeBytes.toLocaleString()`
      renders `1.058.444` on a German locale. Use `toLocaleString("en-US")` for
      deterministic output. The signed JSON is unaffected.
- [ ] **Blind-mode BER** is always 0 (it compares hard decisions to themselves) and the
      Studio still displays it. Either hide it in blind mode or label it "verify mode only".
      Documented in `types/index.d.ts`.
- [ ] **`carrierBand` after filtering** can name the wrong band (all bands reuse one
      spreading sequence, so the hypotheses are not orthogonal). Fixing it means a new wire
      format that invalidates existing watermarks — do it as a versioned change, not a patch.
      Documented in README/WHITEPAPER/TECHNICAL_SPECIFICATIONS.
- [ ] **Known weak cases**, already documented: excerpts shorter than one frame (~1 s at
      44.1 kHz) never decode; 1.8 s crops recover ~half the time; 8 kHz and broadband-noise
      hosts are weak. No action unless the docs change.
- [ ] **Test-suite stall**: one transient >90 s child stall was observed once in ~10 full
      runs (same command is 0.5 s standalone). It is now bounded by a 90 s timeout + one
      retry in `test/distribution.test.js`. If it recurs in CI, look at AV/process-spawn
      contention, not the code.

---

## 4. Business / legal (owner decisions)

- [ ] **Pricing model.** `site/pricing.html` sells **€89/yr / €290/yr subscriptions**; the
      same Polar checkout URL is labelled **$249 / $499 one-time perpetual** in
      `site/docs.html` and `site/legal/terms.html`, and the EULA lists two tiers
      ("Voice AI $4,900/yr", "Audio Forensics $1,499") that are not for sale anywhere.
      One story, one currency, one billing model.
- [ ] **Checkout links are dead right now.** Both `buy.polar.sh/polar_cl_…` URLs 302 to
      `https://polar.sh/404` (verified). Creating the new products and rotating the links is
      part of the pricing work. Licence *validation* is independent and works.
- [ ] **`/legal/*` routing.** `_redirects` sends `/legal/*` to
      `https://kellersystems.dev/legal/` and drops the sub-path; the in-repo
      `site/legal/*.html` copies are unreachable and duplicative. Decide which copy is
      canonical. The same destination is labelled "Terms of Service", "Commercial EULA" and
      "Terms of Sale" on different pages.
- [ ] **C2PA demo wording.** `scripts/c2pa_bridge_example.js` embeds
      "EU AI Act Art. 50 compliant acoustic watermarking" and prints a "Regulatory Note".
      The README disclaims compliance, but if the script ships publicly, neutralise the
      string ("machine-readable tagging demonstration; not a compliance determination").
- [ ] **Landing-page badge** says "EVIDENCE & COMPLIANCE" above a section that correctly
      disclaims authorship/ownership. Consider "EVIDENCE & RECORD-KEEPING".

---

## Reproducing the verification

```bash
npm test                                  # 123 tests, no deps, no ffmpeg needed (2 codec tests skip)
npm run sync:site:check                   # page aliases + generated browser engine drift gate
node audit/15-browser-e2e.mjs             # real headless Chrome/Edge: desktop file:// + web HTTP
node audit/13-rest-rce-poc.mjs            # injection regression (must be inert)
node audit/08-rest-service.mjs            # REST contract (needs ffmpeg for transcode paths)
```
