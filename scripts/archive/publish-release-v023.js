// scripts/publish-release-v023.js
import fs from "node:fs";

const token = process.env.GITHUB_TOKEN || process.env.TOKEN || "";
const repo = "KELLERBABG/Aureal-Watermark";

const body = `# Aureal Watermark v0.2.3 — Production Release

Audio watermarking for anti-theft and AI detection. Inaudible spread-spectrum acoustic steganography and forensic provenance detection engine.

### Highlights in v0.2.3
* **Production Web Studio & Favicon Integration:** Official vector squircle radar favicon across all application routes and root server paths.
* **Minimalist Enterprise Branding:** High-resolution 2400x720 banner featuring vector acoustics and Keller Systems studio typography.
* **Dedicated Documentation Portal:** Real-time client-side documentation hub with 1-click code copying and acoustic science specifications.
* **Promo Leak Distribution Suite:** Generate tagged master copies for reviewers alongside cryptographic recipient manifests (\`scripts/batch_distribute.js\`) and trace leaks in seconds (\`scripts/audit_leak.js\`).
* **Bit-Transparent Headroom Limiting:** True-peak limiter (≤ 0.995) prevents clipping on 0 dBFS commercial masters with dynamic silence muting (≤ -60 dBFS).
* **Zero External Dependencies:** Built with pure ESM JavaScript and standard Node.js / Web Audio APIs (0 npm dependencies).

### Downloads & Assets

| File | Platform | Description |
| :--- | :--- | :--- |
| **\`aureal-watermark.exe\`** | Windows (x64) | **Standalone Executable** — double-click to launch Desktop Studio or automate via command line. |
| **\`aureal-watermark.cjs\`** | Universal (All OS) | **Single-file standalone script** — run directly with \`node aureal-watermark.cjs [command]\` (Node.js ≥ 18). |
| **\`aureal-watermark-v0.2.3-universal.zip\`** | Universal (All OS) | Complete bundle containing CLI, offline Web Studio (\`studio.html\`, \`pricing.html\`, \`docs.html\`), documentation, and assets. |

---

### Quick Start

\`\`\`bash
# 1. Embed tracking ID into an audio file
node aureal-watermark.cjs embed master.wav protected.wav --id 883921

# 2. Check an audio file to see if it contains your ID
node aureal-watermark.cjs detect protected.wav --id 883921

# 3. Blind scan (automatically extracts any embedded ID from an unknown file)
node aureal-watermark.cjs detect mystery_audio.wav --json

# 4. Launch local offline Web Studio
node aureal-watermark.cjs studio
\`\`\`

* **Web Studio:** https://aureal.kellersystems.dev/studio.html
* **Commercial Licensing & Pricing:** https://aureal.kellersystems.dev/pricing.html
* **Documentation:** https://aureal.kellersystems.dev/docs.html
`;

async function main() {
  console.log("Checking for existing releases...");
  
  // 1. Rename release v0.2.2 if its name was v0.2.3
  const get22 = await fetch(`https://api.github.com/repos/${repo}/releases/tags/v0.2.2`, {
    headers: { Authorization: "Bearer " + token, "User-Agent": "NodeJS" }
  });
  if (get22.ok) {
    const rel22 = await get22.json();
    if (rel22.name !== "Aureal Watermark v0.2.2") {
      console.log("Renaming release v0.2.2 to 'Aureal Watermark v0.2.2'...");
      await fetch(`https://api.github.com/repos/${repo}/releases/${rel22.id}`, {
        method: "PATCH",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
          "User-Agent": "NodeJS"
        },
        body: JSON.stringify({ name: "Aureal Watermark v0.2.2" })
      });
      console.log("Release v0.2.2 name normalized.");
    }
  }

  // 2. Check if release v0.2.3 already exists
  const get23 = await fetch(`https://api.github.com/repos/${repo}/releases/tags/v0.2.3`, {
    headers: { Authorization: "Bearer " + token, "User-Agent": "NodeJS" }
  });

  let rel;
  if (get23.ok) {
    rel = await get23.json();
    console.log("Release v0.2.3 exists (ID:", rel.id, "), updating notes...");
    await fetch(`https://api.github.com/repos/${repo}/releases/${rel.id}`, {
      method: "PATCH",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
        "User-Agent": "NodeJS"
      },
      body: JSON.stringify({
        name: "Aureal Watermark v0.2.3",
        body: body,
        draft: false,
        prerelease: false
      })
    });
  } else {
    console.log("Creating new GitHub Release v0.2.3...");
    const createRes = await fetch(`https://api.github.com/repos/${repo}/releases`, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
        "User-Agent": "NodeJS"
      },
      body: JSON.stringify({
        tag_name: "v0.2.3",
        target_commitish: "main",
        name: "Aureal Watermark v0.2.3",
        body: body,
        draft: false,
        prerelease: false
      })
    });
    if (!createRes.ok) {
      const err = await createRes.text();
      throw new Error(`Failed to create release: ${createRes.status} ${err}`);
    }
    rel = await createRes.json();
    console.log("Created release ID:", rel.id);
  }

  // Delete existing assets if re-uploading
  if (rel.assets && rel.assets.length > 0) {
    for (const a of rel.assets) {
      console.log("Deleting previous asset:", a.name);
      await fetch(a.url, {
        method: "DELETE",
        headers: { Authorization: "Bearer " + token, "User-Agent": "NodeJS" }
      });
    }
  }

  // Helper to upload asset
  async function uploadAsset(filePath, assetName, contentType) {
    console.log(`Uploading ${assetName}...`);
    const data = fs.readFileSync(filePath);
    const uploadUrl = `https://uploads.github.com/repos/${repo}/releases/${rel.id}/assets?name=${assetName}`;
    const upRes = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": contentType,
        "User-Agent": "NodeJS"
      },
      body: data
    });
    if (!upRes.ok) {
      const err = await upRes.text();
      console.error(`Failed to upload ${assetName}: ${upRes.status} ${err}`);
    } else {
      console.log(`Uploaded ${assetName} successfully!`);
    }
  }

  await uploadAsset("dist/aureal-watermark.cjs", "aureal-watermark.cjs", "application/javascript");
  await uploadAsset("dist/aureal-watermark-v0.2.3-universal.zip", "aureal-watermark-v0.2.3-universal.zip", "application/zip");
  if (fs.existsSync("dist/aureal-watermark.exe")) {
    await uploadAsset("dist/aureal-watermark.exe", "aureal-watermark.exe", "application/octet-stream");
  }

  console.log("SUCCESS: Release v0.2.3 fully published with all assets!");
}

main().catch(console.error);
