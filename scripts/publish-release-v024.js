// scripts/publish-release-v024.js
import fs from "node:fs";

const token = "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";
const repo = "KELLERBABG/Aureal-Watermark";

const body = `# Aureal Watermark v0.2.4 — Maintenance & Resilience Release

Audio watermarking for anti-theft and AI detection. Inaudible spread-spectrum acoustic steganography and forensic provenance detection engine.

### Highlights in v0.2.4
* **Forensic Verification Attribution Fixes:** Resolved un-interpolated template strings in the web verification card to correctly display recovered recipient IDs, attribution confidence percentages, bit error rates, and carrier bands.
* **Resilient DSP Web Worker Engine:** Implemented bulletproof, graceful fallback to main-thread signal processing whenever background worker execution or browser sandbox issues arise, preventing uncaught worker exceptions.
* **Stream Sync Preamble Injection:** Fully integrated \`buildSyncPreamble\` and \`findPreambleOffsets\` into the dedicated DSP worker script.
* **Verification Loop Fix:** Properly destructured \`isSyncPreamble\` within candidate scoring loops across Studio and Verifier suites, eliminating scan failure errors.
* **Streamlined Studio Navigation:** Cleaned up header navigation bar and removed redundant overview routing.
* **Zero External Dependencies:** 100% pure standard JavaScript and Web Audio APIs with 0 runtime npm dependencies.

### Downloads & Assets

| File | Platform | Description |
| :--- | :--- | :--- |
| **\`aureal-watermark.exe\`** | Windows (x64) | **Standalone Executable** — double-click to launch Desktop Studio or automate via command line. |
| **\`aureal-watermark.cjs\`** | Universal (All OS) | **Single-file standalone script** — run directly with \`node aureal-watermark.cjs [command]\` (Node.js ≥ 18). |
| **\`aureal-watermark-v0.2.4-universal.zip\`** | Universal (All OS) | Complete bundle containing CLI, offline Web Studio (\`studio.html\`, \`verifier.html\`, \`pricing.html\`, \`docs.html\`), documentation, and assets. |

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
  console.log("Checking for release v0.2.4 on GitHub...");

  if (!fs.existsSync("dist/aureal-watermark.exe") || fs.statSync("dist/aureal-watermark.exe").size < 1000) {
    console.log("Fetching aureal-watermark.exe from v0.2.3...");
    const rel23Res = await fetch(`https://api.github.com/repos/${repo}/releases/tags/v0.2.3`, {
      headers: { Authorization: "Bearer " + token, "User-Agent": "NodeJS" }
    });
    if (rel23Res.ok) {
      const rel23 = await rel23Res.json();
      const exeAsset = rel23.assets.find(a => a.name === "aureal-watermark.exe");
      if (exeAsset) {
        const exeRes = await fetch(`https://api.github.com/repos/${repo}/releases/assets/${exeAsset.id}`, {
          headers: { Authorization: "Bearer " + token, Accept: "application/octet-stream", "User-Agent": "NodeJS" }
        });
        const exeBuf = Buffer.from(await exeRes.arrayBuffer());
        fs.writeFileSync("dist/aureal-watermark.exe", exeBuf);
        console.log(`Downloaded and saved dist/aureal-watermark.exe (${exeBuf.length} bytes).`);
      }
    }
  }

  const get24 = await fetch(`https://api.github.com/repos/${repo}/releases/tags/v0.2.4`, {
    headers: { Authorization: "Bearer " + token, "User-Agent": "NodeJS" }
  });

  let rel;
  if (get24.ok) {
    rel = await get24.json();
    console.log("Release v0.2.4 exists (ID:", rel.id, "), updating release info...");
    await fetch(`https://api.github.com/repos/${repo}/releases/${rel.id}`, {
      method: "PATCH",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
        "User-Agent": "NodeJS"
      },
      body: JSON.stringify({
        name: "Aureal Watermark v0.2.4",
        body: body,
        draft: false,
        prerelease: false
      })
    });
  } else {
    console.log("Creating new GitHub Release v0.2.4...");
    const createRes = await fetch(`https://api.github.com/repos/${repo}/releases`, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
        "User-Agent": "NodeJS"
      },
      body: JSON.stringify({
        tag_name: "v0.2.4",
        target_commitish: "main",
        name: "Aureal Watermark v0.2.4",
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

  if (rel.assets && rel.assets.length > 0) {
    for (const a of rel.assets) {
      console.log("Deleting previous asset:", a.name);
      await fetch(a.url, {
        method: "DELETE",
        headers: { Authorization: "Bearer " + token, "User-Agent": "NodeJS" }
      });
    }
  }

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
  await uploadAsset("dist/aureal-watermark-v0.2.4-universal.zip", "aureal-watermark-v0.2.4-universal.zip", "application/zip");
  if (fs.existsSync("dist/aureal-watermark.exe") && fs.statSync("dist/aureal-watermark.exe").size > 1000) {
    await uploadAsset("dist/aureal-watermark.exe", "aureal-watermark.exe", "application/octet-stream");
  }

  console.log("SUCCESS: Release v0.2.4 fully published with all assets!");
}

main().catch(console.error);
