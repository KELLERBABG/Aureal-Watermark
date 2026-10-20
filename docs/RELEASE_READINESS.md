# Aureal Watermark Release Readiness Review

## Recommendation: Not ready for a public production release yet

The benchmark results below were measured by running the documented commands manually on local fixtures (Windows, FFmpeg installed), and the moved web pages build into the CLI bundle. However, the release pipeline and website packaging have unresolved defects, and public-facing regulatory, compatibility, and licensing statements are not yet consistently supported by the implementation and the local fixtures.

## Verified in this checkout

- `npm test` (`node --test`): runs the suite in `test/` (payload/CRC, WAV I/O, watermark round-trip and band handling, forensic seal + verification, CLI contract, REST service, generated browser engine/page adapters, batch distribution + leak audit). It must pass on every supported Node version.
- `node scripts/bundle.js`: completed successfully with the HTML pages in `site/`.
- The grouped HTML tree, clean routes and legacy aliases are enforced by `npm run sync:site:check`; `test/browser-engine.test.js` parses every inline page script and asserts the pages load the generated engine instead of an inlined copy.
- HTML now lives under `site/`, with the existing URL map retained in the root `_redirects` file.

These are local checks only; the GitHub release workflow has not been run here, and Linux/macOS/other Node versions were not verified.

## Ship blockers

1. **Offline ZIP navigation (partially addressed).** The desktop bundle now rewrites site-absolute links for `file://` use: `/studio` and `/pricing` resolve to the bundled sibling `studio.html`/`pricing.html` in the temp directory, `href="/"` collapses to an in-page anchor, `src="/assets/*"` is rewritten to the local `assets/` directory (the DSP engine and offline MP3 encoder are written there), and remaining web-only links (`/docs`, `/legal/*`, favicons) either point at the live site via `AUREAL_SITE_BASE_URL` or become inert placeholders. `test/` does not launch a browser, so this is verified by asserting the rewritten HTML and the shipped asset files. Still to smoke-test: launch the actual published SEA binary and ZIP on each advertised platform and confirm the rewritten links behave as expected (including the `AUREAL_SITE_BASE_URL` variant).
2. **HTML variant divergence (resolved, keep enforced).** All page variants are now generated: `site/index.html` and `site/<page>.html` are the canonical sources, and the `site/<page>/index.html` aliases are byte-identical copies produced by `npm run sync:site` (`scripts/sync-site.js`). Prior divergent content was reconciled (docs sections restored to the canonical, mojibake fixed in the pricing page, landing hero badges merged). `npm run sync:site:check` fails if an alias is edited directly and provides a standalone CI gate; there is no `test/ui.test.js` in the repository.
3. **CI/release matrix isn't proven.** Only the current local Windows Node run is verified. Test the release build end-to-end on all claimed target operating systems, including launching each SEA binary and exercising packaged ZIP paths/assets.
4. **Product claims need a final sweep.** README and older documents still include strong guarantees (including near-universal detection, courtroom/legal language, and C2PA recovery or regulatory-compliance wording) that are unsupported by the current fixtures or report implementation. Make the claims consistently match bounded, named fixtures; get qualified review before making legal-compliance claims.
5. **Commercial offering (aligned; business facts still need owner confirmation).** All surfaces now tell the same story: README, `docs/COMMERCIAL_LICENSING.md`, the pricing page, the docs licensing table, and both EULA renderings list the same five tiers at the same prices ($249 Solo, $499 Label, $2,900+/yr B2B, from $4,900/yr Voice AI, $1,499 Forensics Lab). Regulatory/compliance and court-admissibility language is consistently disclaimed everywhere, and the fake-client-side-card checkout modal on the pricing page still requires a product decision (remove it or wire it to a real payment processor) before accepting real payments. The Polar checkout links have not been validated end-to-end.
6. **Deployment (platform confirmed; routes still unverified).** The target platform is confirmed as Cloudflare Pages, and `_redirects` is Cloudflare Pages syntax. Still to verify on the target domain: the build output / root directory setting, asset paths, and the `/`, `/studio`, `/docs`, `/pricing`, `/verifier`, and `/legal/*` routes.

## Known technical limitations to disclose

- A watermark ID match is not proof of authorship, ownership, identity, creation time, or chain of custody.
- The report HMAC is a shared-secret integrity mechanism; its built-in default is public and it is not a public-key signature.
- Low-pass outcomes are fixture-dependent: on the 12 s stereo fixture a 16 kHz low-pass lost the dual-band watermark while 12 kHz and 7 kHz recovered it (the mid-band carrier is what survives). Same-key re-embedding with a conflicting ID is not reliably recoverable.
- Fixture outcomes do not imply detection guarantees for every content type, codec, platform, playback device, or acoustic environment.
- Collusion/averaging attacks defeat recovery: the product does not implement collusion-resistant fingerprinting, so averaging independently tagged copies erases the recovered ID.
- Excerpts shorter than one frame (~1 s at 44.1 kHz) are never recovered; ~1.8 s excerpts recover for roughly half of the start offsets swept on a local fixture.
- The reported carrier band can be wrong when the signal has been filtered, because both band hypotheses reuse the same spreading sequence.

## Before shipping

1. Canonical web pages are selected and aliases are generated (`npm run sync:site`); keep it that way for future edits.
2. Resolve and test the universal ZIP/offline behavior and target routes (links are now rewritten for `file://`; verify the shipped SEA binaries and ZIP end-to-end).
3. Run and retain the CI/release matrix output on each advertised platform.
4. Marketing, pricing, licensing, and regulatory claims are reconciled across surfaces; validate the actual checkout flow (Polar links or a replacement for the demo card modal) before accepting payment.
5. Validate website deployment, purchasing/activation, and error paths using production-like staging, without publishing a release until approved.
