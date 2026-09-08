import fs from "node:fs";

const token = process.env.GITHUB_TOKEN || process.env.TOKEN || "";

const updatedBody = `# Aureal Watermark v0.2.1 — Universal Release

Audio watermarking for anti-theft and AI detection. Inaudible spread-spectrum acoustic steganography and provenance detection engine.

### Highlights
* **Universal Single-File Bundle:** Run directly with Node.js on any operating system (Windows, macOS, Linux) with zero dependencies.
* **Offline Web Studio:** Interactive audio workspace running 100% client-side in your browser.
* **Lossy Codec Resilience:** Verified against MP3 (128k/320k) and AAC (128k) transcoding round-trips.
* **Dual License:** Free for personal and hobby use; commercial license for business and monetization pipelines.

### Downloads & Assets

| File | Platform | Description |
| :--- | :--- | :--- |
| **\`aureal-watermark.cjs\`** | Universal (All OS) | **Single-file standalone script** — run directly with \`node aureal-watermark.cjs [command]\` (Node.js ≥ 18). |
| **\`aureal-watermark-v0.2.1-universal.zip\`** | Universal (All OS) | Complete bundle with \`aureal-watermark.cjs\` + offline Web Studio (\`studio.html\`) + documentation. |

---

### Quick Start (Universal Script)

\`\`\`bash
# 1. Embed tracking ID into an audio file
node aureal-watermark.cjs embed master.wav protected.wav --id 883921

# 2. Check an audio file to see if it contains your ID
node aureal-watermark.cjs detect protected.wav --id 883921

# 3. Launch local Web Studio
node aureal-watermark.cjs studio
\`\`\`

Online Web Studio: https://kellerbabg.github.io/Aureal-Watermark/
`;

async function updateRelease() {
  const getRel = await fetch("https://api.github.com/repos/KELLERBABG/Aureal-Watermark/releases/tags/v0.2.1", {
    headers: { Authorization: "Bearer " + token, "User-Agent": "NodeJS" }
  });
  const rel = await getRel.json();

  // Delete unwanted .exe and windows-x64.zip
  for (const a of rel.assets) {
    if (a.name.endsWith(".exe") || a.name.includes("windows-x64")) {
      console.log("Deleting asset:", a.name);
      await fetch(a.url, {
        method: "DELETE",
        headers: { Authorization: "Bearer " + token, "User-Agent": "NodeJS" }
      });
    }
  }

  // Update release body
  console.log("Updating release body...");
  await fetch("https://api.github.com/repos/KELLERBABG/Aureal-Watermark/releases/" + rel.id, {
    method: "PATCH",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
      "User-Agent": "NodeJS"
    },
    body: JSON.stringify({
      body: updatedBody
    })
  });

  // Ensure aureal-watermark.cjs is uploaded
  fs.copyFileSync("dist/cli.cjs", "dist/aureal-watermark.cjs");
  console.log("Uploading direct aureal-watermark.cjs...");
  const cjsBuf = fs.readFileSync("dist/aureal-watermark.cjs");
  await fetch("https://uploads.github.com/repos/KELLERBABG/Aureal-Watermark/releases/" + rel.id + "/assets?name=aureal-watermark.cjs", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/javascript",
      "User-Agent": "NodeJS"
    },
    body: cjsBuf
  });

  console.log("SUCCESS: Release v0.2.1 updated to Universal-only distribution!");
}

updateRelease().catch(console.error);
