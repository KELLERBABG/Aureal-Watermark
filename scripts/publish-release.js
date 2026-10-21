// scripts/publish-release.js — manual release publisher (the CI workflow uses
// softprops/action-gh-release instead). Version and asset names are derived from
// package.json so this script cannot drift from the build.
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { version } = require("../package.json");
const tag = `v${version}`;
const zipName = `aureal-watermark-v${version}-universal.zip`;
const exe = "dist/aureal-watermark.exe";
const cjs = "dist/aureal-watermark.cjs";

const token = process.env.GITHUB_TOKEN || process.env.TOKEN || "";
const repo = "KELLERBABG/Aureal-Watermark";

const body = `# Aureal Watermark ${tag} — Audio Watermarking and Leak Investigation Tools

Aureal embeds keyed audio IDs for leak investigation and recovery testing. Detection depends on content, carrier settings, and transformations. A match is not proof of authorship or provenance.

**Focus of this release:** the CLI, the Web Studio and the embedded Desktop Studio now run the same engine (the browser copy is generated from \`src/\`), the forensic report seal covers the whole report and can be verified, and the repository ships an automated test suite.

---

### Key Highlights in ${tag}

* **One DSP engine everywhere.** \`assets/aureal-engine.js\` is generated from \`src/\` by \`scripts/build-engine.js\`, so the Web Studio, the Verifier, the landing-page demo and the CLI cannot diverge. CI fails if a stale copy is committed.
* **Verifiable audit reports.** The HMAC seal now signs the whole report body (verdict, payload ID, metrics, file hashes), and \`auralwatermark verify-report proof.json --key <secret>\` re-checks it. Legacy seals are rejected explicitly.
* **Multi-Format Audio Export (WAV & MP3).** WAV 16-bit, WAV 24-bit, or MP3 (320/192/128 kbps) with the offline pure-JS LAME encoder — no CDN, no network.
* **Carrier bands.** High 17–19.5 kHz, mid 4.5–13.5 kHz, both (default), or a custom \`lowHz:highHz\` range. At low sample rates the engine fits a single usable band instead of collapsing to a tone.
* **Runtime hardening.** The REST microservice validates output formats against an allow-list and never passes caller data to a shell.
* **Removed claim.** Collusion-resistant fingerprinting is **not** implemented: averaging independently tagged copies defeats recovery. This is now stated in the README, docs and pricing matrix instead of advertised as a feature.
* **Test suite.** \`npm test\` runs the \`node --test\` suite (payload/CRC, WAV I/O, watermark round-trip and bands, report seal, CLI, REST, browser engine, distribution scripts). No dependencies, no ffmpeg required.

---

### Downloads & Release Assets

| File | Platform | Description |
| :--- | :--- | :--- |
| **\`aureal-watermark.exe\`** | Windows (x64) | Standalone executable — double-click to launch the Desktop Studio, or run it as a CLI. |
| **\`aureal-watermark.cjs\`** | Universal (all OS) | Single-file standalone script — \`node aureal-watermark.cjs [command]\` (Node.js >= 18). |
| **\`${zipName}\`** | Universal (all OS) | CLI, offline Desktop Studio, documentation and assets. |

---

### Quick Start

\`\`\`bash
# Launch the offline Desktop Studio (default)
./aureal-watermark.exe

# Or run headless CLI operations
./aureal-watermark.exe embed master.wav protected.wav --id 883921
./aureal-watermark.exe detect protected.wav --id 883921
./aureal-watermark.exe verify-report proof.json --key <secret>
\`\`\`

* **Web Studio:** https://aureal.kellersystems.dev/studio
* **Documentation:** https://aureal.kellersystems.dev/docs
`;

async function api(path, init = {}) {
  return fetch(`https://api.github.com/repos/${repo}${path}`, {
    ...init,
    headers: {
      Authorization: "Bearer " + token,
      "User-Agent": "NodeJS",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers || {}),
    },
  });
}

async function main() {
  if (!token) throw new Error("GITHUB_TOKEN (or TOKEN) is required.");
  if (!fs.existsSync(cjs)) throw new Error(`${cjs} is missing — run scripts/bundle.js first.`);
  console.log(`Publishing ${tag} ...`);

  const found = await api(`/releases/tags/${tag}`);
  let release;
  if (found.ok) {
    release = await found.json();
    console.log(`Updating existing release (id ${release.id}) ...`);
    const patched = await api(`/releases/${release.id}`, {
      method: "PATCH",
      body: JSON.stringify({ name: `Aureal Watermark ${tag}`, body, draft: false, prerelease: false }),
    });
    if (!patched.ok) throw new Error(`PATCH failed: ${patched.status} ${await patched.text()}`);
    release = await patched.json();
  } else {
    console.log("Creating a new release ...");
    const created = await api("/releases", {
      method: "POST",
      body: JSON.stringify({
        tag_name: tag,
        target_commitish: "main",
        name: `Aureal Watermark ${tag}`,
        body,
        draft: false,
        prerelease: false,
      }),
    });
    if (!created.ok) throw new Error(`POST failed: ${created.status} ${await created.text()}`);
    release = await created.json();
  }

  for (const asset of release.assets || []) {
    console.log(`Deleting previous asset ${asset.name} ...`);
    await api(`/releases/assets/${asset.id}`, { method: "DELETE" });
  }

  const uploads = [
    [cjs, "aureal-watermark.cjs", "application/javascript"],
    [`dist/${zipName}`, zipName, "application/zip"],
    [exe, "aureal-watermark.exe", "application/octet-stream"],
  ];
  for (const [file, name, type] of uploads) {
    if (!fs.existsSync(file)) {
      console.warn(`skipping ${name} (${file} not built)`);
      continue;
    }
    console.log(`Uploading ${name} ...`);
    const res = await fetch(`https://uploads.github.com/repos/${repo}/releases/${release.id}/assets?name=${encodeURIComponent(name)}`, {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": type, "User-Agent": "NodeJS" },
      body: fs.readFileSync(file),
    });
    if (!res.ok) throw new Error(`upload of ${name} failed: ${res.status} ${await res.text()}`);
  }

  console.log(`SUCCESS: ${tag} published.`);
}

main().catch((err) => {
  console.error("publish-release failed:", err.message || err);
  process.exitCode = 1;
});
