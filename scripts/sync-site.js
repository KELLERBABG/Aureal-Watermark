// scripts/sync-site.js — keep generated alias variants identical to their canonical source.
//
// Each page is served at two URLs: its clean route (via _redirects) and a folder
// alias, e.g. /docs -> site/docs.html and /site/docs/index.html. The top-level
// `site/<page>.html` file IS the page; the `site/<page>/index.html` alias is a
// byte-for-byte copy of it, so the alias must never be edited directly: edit
// `site/<page>.html`, then run `npm run sync:site`.
//
// Canonical sources and their generated aliases:
//   site/index.html          -> (no alias; served at /)
//   site/docs.html           -> site/docs/index.html
//   site/pricing.html        -> site/pricing/index.html
//   site/studio.html         -> site/studio/index.html
//   site/verifier.html       -> site/verifier/index.html
// Legal pages are single-source (site/legal/*.html) and are not copied.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const GROUPS = [
  { canonical: "site/index.html", aliases: [] },
  { canonical: "site/docs.html", aliases: ["site/docs/index.html"] },
  { canonical: "site/pricing.html", aliases: ["site/pricing/index.html"] },
  { canonical: "site/studio.html", aliases: ["site/studio/index.html"] },
  { canonical: "site/verifier.html", aliases: ["site/verifier/index.html"] },
];

const check = process.argv.includes("--check");
let drift = 0;

for (const { canonical, aliases } of GROUPS) {
  const source = readFileSync(join(root, canonical));

  for (const alias of aliases) {
    const aliasPath = join(root, alias);
    let existing;
    try {
      existing = readFileSync(aliasPath);
    } catch {
      existing = null;
    }

    if (!existing || !existing.equals(source)) {
      if (check) {
        console.error(`DRIFT: ${alias} differs from canonical ${canonical}`);
        drift += 1;
      } else {
        writeFileSync(aliasPath, source);
        console.log(`synced ${alias} <- ${canonical}`);
      }
    } else {
      console.log(`ok      ${alias}`);
    }
  }
}

if (check && drift > 0) {
  console.error(`\n${drift} alias file(s) drifted from their canonical source.`);
  console.error("Run `npm run sync:site` to regenerate them, then commit the result.");
  process.exit(1);
}
