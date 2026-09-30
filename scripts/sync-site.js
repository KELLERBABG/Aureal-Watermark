// scripts/sync-site.js — keep generated alias variants identical to their canonical source.
//
// The site intentionally serves the same page at two URLs (clean route plus a
// folder alias, e.g. /docs -> site/demo/docs.html and /site/docs/... ). Every
// alias is a byte-for-byte copy of its canonical file, so it must never be
// edited directly: edit the canonical, then run `npm run sync:site`.
//
// Canonical sources and their generated aliases:
//   site/demo/index.html     -> site/index.html            (landing)
//   site/demo/docs.html      -> site/docs.html
//                             -> site/docs/index.html
//   site/demo/pricing.html   -> site/pricing.html
//                             -> site/pricing/index.html
//   site/demo/studio.html    -> site/studio.html
//                             -> site/studio/index.html
//   site/demo/verifier.html  -> site/verifier.html
//                             -> site/verifier/index.html
// Legal pages are single-source (site/legal/*.html) and are not copied.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const GROUPS = [
  { canonical: "site/demo/index.html", aliases: ["site/index.html"] },
  {
    canonical: "site/demo/docs.html",
    aliases: ["site/docs.html", "site/docs/index.html"],
  },
  {
    canonical: "site/demo/pricing.html",
    aliases: ["site/pricing.html", "site/pricing/index.html"],
  },
  {
    canonical: "site/demo/studio.html",
    aliases: ["site/studio.html", "site/studio/index.html"],
  },
  {
    canonical: "site/demo/verifier.html",
    aliases: ["site/verifier.html", "site/verifier/index.html"],
  },
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
