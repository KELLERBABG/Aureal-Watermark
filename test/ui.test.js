import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");

test("license records never persist a full key", () => {
  const source = read("src/license.js");
  assert.match(source, /delete safeRecord\.key/);
  assert.match(source, /&& !parsed\.key/);
});

test("studio license modal exposes accessible dialog semantics", () => {
  const source = read("site/studio.html");
  assert.match(source, /role="dialog"/);
  assert.match(source, /aria-modal="true"/);
  assert.match(source, /aria-live="polite"/);
  assert.match(source, /e\.key === "Escape"/);
  assert.match(source, /e\.key === "Tab"/);
  assert.match(source, /aria-label="Close license dialog"/);
});

test("landing page keeps claims and navigation regression-safe", () => {
  const source = read("site/index.html");
  assert.doesNotMatch(source, /\uFFFD|â€|Ã/);
  assert.match(source, /nav-toggle/);
  assert.match(source, /scanDurationMs/);
  assert.match(source, /Live In-Browser Demo/);
  assert.doesNotMatch(source, /WATERMARK VERIFIED/);
});

test("static HTML pages are grouped under site and public routes stay mapped", () => {
  // The canonical page files live under site/; the root index.html is a
  // generated, byte-identical alias that Cloudflare Pages serves for "/".
  for (const page of ["docs.html", "pricing.html", "studio.html", "verifier.html"]) {
    assert.equal(fs.existsSync(path.join(root, "site", page)), true, `site/${page} should exist`);
  }
  assert.equal(fs.existsSync(path.join(root, "index.html")), true, "root index.html alias should exist");

  const redirects = read("_redirects");
  for (const page of ["studio", "docs", "pricing", "verifier"]) {
    assert.match(redirects, new RegExp(`/${page}\\s+/site/${page}/\\s+200`), `/${page} should map to site/${page}/`);
  }
  assert.match(redirects, /\/legal\/\*\s+https:\/\/kellersystems\.dev\/legal\/\s+301/);
  assert.match(redirects, /\/site\/index\.html\s+\/\s+301/);
  // Legacy site/demo paths redirect (301) to clean routes; they must never be
  // served as 200 destinations again.
  for (const page of ["index", "studio", "docs", "pricing", "verifier"]) {
    assert.match(
      redirects,
      new RegExp(`/site/demo/${page}(?:\\.html)?\\s+/\\S*\\s+301`),
      `legacy /site/demo/${page} should 301 to a clean route`
    );
    assert.doesNotMatch(redirects, new RegExp(`/site/demo/${page}(?:\\.html)?\\s+200`));
  }
  assert.equal(fs.existsSync(path.join(root, "_redirects")), true);
  assert.equal(fs.existsSync(path.join(root, "site", "_redirects")), false);
});

test("legal pages link directly to homepage and preserve cross-page links", () => {
  for (const page of ["impressum.html", "privacy.html", "terms.html"]) {
    const source = read(`site/legal/${page}`);
    assert.match(source, /<a href="\/" class="nav-btn">Homepage<\/a>/);
    assert.match(source, /<a href="\/studio" class="nav-btn">&larr; Studio<\/a>/);
  }

  for (const page of ["site/docs/index.html", "site/docs.html", "site/pricing/index.html", "site/pricing.html"]) {
    assert.match(read(page), /<a href="\/" class="(?:nav-link|nav-btn)">Homepage<\/a>/, `${page} should link to homepage`);
  }
  for (const page of ["site/studio.html", "site/verifier.html"]) {
    assert.match(read(page), /<a href="\/"[^>]*>[\s\S]{0,150}?Homepage[\s\S]{0,30}?<\/a>/, `${page} should link to homepage`);
  }
  assert.doesNotMatch(read("site/docs.html"), /unbroken evidentiary chain of custody|HMAC-SHA256 digital signature/i);
  assert.match(read("site/docs.html"), /HMAC is not a digital signature/i);
  // Legal pages cross-link to the canonical site documents on kellersystems.dev.
  assert.match(read("site/legal/impressum.html"), /href="https:\/\/kellersystems\.dev\/privacy\/"/);
  assert.match(read("site/legal/privacy.html"), /href="https:\/\/kellersystems\.dev\/impressum\/"/);
  assert.match(read("site/legal/terms.html"), /href="https:\/\/kellersystems\.dev\/privacy\/"/);
});

test("watermark audit UI does not overstate detection as authentication", () => {
  for (const page of ["site/studio.html", "site/verifier.html"]) {
    const source = read(page);
    assert.doesNotMatch(source, /AUTHENTICITY VERIFIED|VERIFIED_AUTHENTIC/);
    assert.match(source, /WATERMARK ID MATCH/);
  }

  const landing = read("site/index.html");
  assert.doesNotMatch(landing, /VERIFIED AUTHENTIC|Target Recipient Verified|Survives 100%|court-ready cryptographic proofs/i);
  assert.doesNotMatch(landing, /cryptographically signed using an air-gapped HMAC|0\.0 dB DELTA.*INAUDIBLE/i);
  assert.match(landing, /not independent proof of authorship/);
  assert.match(landing, /not a public-key signature/);
  assert.match(landing, /does not establish chain of custody/);
  assert.match(landing, /SAMPLE AUDIT REPORT/);
  assert.match(landing, /Illustrative placeholder; not a computed file hash/);
  assert.match(landing, /NOT CRYPTOGRAPHICALLY SIGNED/);

  assert.match(read("site/verifier.html"), /not proof of authorship, ownership/);
  assert.doesNotMatch(read("site/verifier.html"), /court copyright claims|Download Forensic Audit Certificate/);
});

test("desktop bundle rewrites site-absolute links for offline file:// use", () => {
  // Extract the real adaptHtmlForOffline() implementation from the CLI so the
  // test exercises the exact logic that ships in the SEA/zip bundle.
  const cliSource = read("bin/auralwatermark.js");
  const fnMatch = cliSource.match(/const OFFLINE_LOCAL_PATHS[\s\S]*?\nfunction adaptHtmlForOffline\(html\) \{[\s\S]*?\n\}/);
  assert.ok(fnMatch, "adaptHtmlForOffline should exist in the CLI source");
  const adaptHtmlForOffline = new Function(`${fnMatch[0]};\nreturn adaptHtmlForOffline;`)();

  // No AUREAL_SITE_BASE_URL set: local targets resolve to tmp siblings,
  // homepage stays on-page, and web-only links become inert placeholders.
  const sample = [
    '<link rel="icon" href="/assets/favicon.svg">',
    '<a href="/">Homepage</a>',
    '<a href="/studio">Studio</a>',
    '<a href="/pricing">Pricing</a>',
    '<a href="/docs">Docs</a>',
    '<a href="/legal/impressum.html">Impressum</a>',
  ].join("\n");
  const out = adaptHtmlForOffline(sample);
  assert.match(out, /href="#"/); // homepage link collapses to in-page anchor
  assert.match(out, /href="studio.html"/); // studio resolvable via tmp sibling
  assert.match(out, /href="pricing.html"/); // pricing resolvable via tmp sibling
  assert.match(out, /data-offline-unavailable="\/docs"/);
  assert.match(out, /data-offline-unavailable="\/legal\/impressum.html"/);
  assert.doesNotMatch(out, /href="\/(?:studio|pricing|docs|legal)/); // no absolute site paths left
  assert.doesNotMatch(out, /href="\/"/);

  // With AUREAL_SITE_BASE_URL, remaining web-only links point at the live site.
  process.env.AUREAL_SITE_BASE_URL = "https://aureal.kellersystems.dev";
  try {
    const online = adaptHtmlForOffline(sample);
    assert.match(online, /https:\/\/aureal\.kellersystems\.dev\/docs/);
    assert.match(online, /https:\/\/aureal\.kellersystems\.dev\/legal\/impressum\.html/);
    assert.match(online, /href="studio.html"/); // studio stays local even when base URL is set
    assert.match(online, /href="pricing.html"/);
  } finally {
    delete process.env.AUREAL_SITE_BASE_URL;
  }

  // The bundled studio page contains no site-absolute links that would break
  // offline once rewritten (favicons stripped, nav links localized).
  const rewritten = adaptHtmlForOffline(read("site/studio.html"));
  assert.doesNotMatch(rewritten, /href="\//);
});

test("generated site alias variants are byte-identical to their canonical source", () => {
  // Aliases are produced by `npm run sync:site` (scripts/sync-site.js) from
  // the canonical files under site/. Direct edits to an alias will be
  // overwritten on the next sync — edit the canonical instead.
  const groups = [
    ["site/index.html", ["index.html"]],
    ["site/docs.html", ["site/docs/index.html"]],
    ["site/pricing.html", ["site/pricing/index.html"]],
    ["site/studio.html", ["site/studio/index.html"]],
    ["site/verifier.html", ["site/verifier/index.html"]],
  ];
  for (const [canonical, aliases] of groups) {
    const source = fs.readFileSync(path.join(root, canonical));
    for (const alias of aliases) {
      const copy = fs.readFileSync(path.join(root, alias));
      assert.ok(
        source.equals(copy),
        `${alias} has drifted from canonical ${canonical}; run 'npm run sync:site'`
      );
    }
  }
});
