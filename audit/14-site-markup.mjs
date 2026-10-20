// 14: site markup health — regression checks for the defects found in the audit
import { readFileSync } from "node:fs";

const checks = [];
const check = (name, pass, detail = "") => checks.push({ name, pass: !!pass, detail });

const pages = ["site/index.html", "site/docs.html", "site/pricing.html", "site/studio.html", "site/verifier.html"];

for (const file of pages) {
  const html = readFileSync(file, "utf8");

  // A `data:` URI pasted raw into an HTML attribute terminates the attribute at the first quote.
  check(`${file}: no raw data-URI fragment in an attribute`, !/=\"[^\"]*\\"[^>]*>/.test(html) && !/%2394a3b8\\"/.test(html));
  check(`${file}: no mojibake warning glyph`, !html.includes(String.fromCharCode(0xef, 0xb8, 0x8f)));
  check(`${file}: has a canonical link`, /<link rel="canonical" href="https:\/\/aureal\.kellersystems\.dev/.test(html));
  check(`${file}: og:image is self-hosted`, !/raw\.githubusercontent\.com/.test(html));

  // Every <select> must open with a complete, valid tag.
  const selectTags = [...html.matchAll(/<select\b[^>]*>/g)].map((m) => m[0]);
  for (const tag of selectTags) {
    const id = (tag.match(/id="([^"]+)"/) || [])[1] ?? "?";
    check(`${file}: select tag is well formed (${id})`, !/\\"/.test(tag) && /^<select(\s+[a-z-]+="[^"]*")*\s*>$/.test(tag), tag.slice(0, 90));
  }

  // target="_blank" needs rel=noopener
  const blankLinks = [...html.matchAll(/<a\b[^>]*target="_blank"[^>]*>/g)].map((m) => m[0]);
  const unsafe = blankLinks.filter((tag) => !/\brel=/.test(tag));
  check(`${file}: every target="_blank" has rel`, unsafe.length === 0, unsafe.slice(0, 2).join(" | "));
}

// Labels that describe a file input must point at it.
for (const file of ["site/studio.html", "site/verifier.html"]) {
  const html = readFileSync(file, "utf8");
  const labels = [...html.matchAll(/<label(?![^>]*\bfor=)[^>]*>([^<]*)<\/label>/g)].map((m) => m[0]);
  check(`${file}: file-input labels are associated`, labels.length === 0, labels.join(" | "));
}

// The pricing toggle must be nameable, styled for both states, and drive the matrix.
{
  const html = readFileSync("site/pricing.html", "utf8");
  check("pricing: toggle has an accessible name", /id="pricing-toggle"[^>]*aria-label="[^"]+"/.test(html));
  check("pricing: toggle has a checked-state style", /#pricing-toggle:checked \+ \.billing-track/.test(html));
  check("pricing: matrix headers are dynamic", /id="th-creator"/.test(html) && /id="th-label"/.test(html));
  check("pricing: matrix header updates with the toggle", /thCreator\.textContent/.test(html));
  check("pricing: capability matrix is an h2", /<h2 class="section-title">Technical Capability Matrix<\/h2>/.test(html));
  check("pricing: no Tardos capability claims remain", !/Tardos|anti-collusion/i.test(html));
}

let bad = 0;
for (const c of checks) { if (!c.pass) bad++; console.log(`${c.pass ? "PASS" : "FAIL"}  ${c.name}${c.detail ? "  [" + c.detail + "]" : ""}`); }
console.log(`\n${checks.length - bad}/${checks.length} passed`);
