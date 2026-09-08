// scripts/create-release-v021.js

const token = process.env.GITHUB_TOKEN || process.env.TOKEN || "";
import fs from "node:fs";

const body = `# Aureal Watermark v0.2.1 — Production Release

Audio watermarking for anti-theft and AI detection. Inaudible spread-spectrum acoustic steganography and provenance detection engine.

### Highlights in v0.2.1
* **Standalone Desktop Application:** Double-clicking the Windows \`.exe\` launches a dedicated, offline studio window with the audio player, drag-and-drop workspace, and visual analyzer.
* **Spec-Compliant Windows Icon:** Multi-resolution DIB bitmap and 256px PNG icon stamped into the PE binary.
* **Streamlined Documentation:** Clean, creator-friendly README with deep-dive DSP math moved to dedicated technical specifications.
* **Zero External Dependencies:** Built with pure ESM JavaScript and standard Node.js / Web Audio APIs (0 npm packages).
* **Lossy Codec Resilience:** Verified against MP3 (128k/320k) and AAC (128k) transcoding round-trips.

### Downloads & Assets

| File | Platform | Description |
| :--- | :--- | :--- |
| **\`aureal-watermark-windows-x64.exe\`** | Windows (x64) | **Direct executable** — double-click to launch Desktop Studio, or run from command line for server automation. |
| **\`aureal-watermark-v0.2.1-windows-x64.zip\`** | Windows (x64) | Standalone \`.exe\` + offline Web Studio (\`studio.html\`) + documentation. |
| **\`aureal-watermark-v0.2.1-universal.zip\`** | All (Linux/macOS/Win) | Cross-platform bundle (\`aureal-watermark.cjs\`) for systems with Node.js ≥ 18 + offline Web Studio. |

Online Web Studio: https://kellerbabg.github.io/Aureal-Watermark/
`;

async function publishRelease() {
  console.log("Creating GitHub Release v0.2.1...");
  const createRes = await fetch("https://api.github.com/repos/KELLERBABG/Aureal-Watermark/releases", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
      "User-Agent": "NodeJS"
    },
    body: JSON.stringify({
      tag_name: "v0.2.1",
      target_commitish: "main",
      name: "Aureal Watermark v0.2.1",
      body: body,
      draft: false,
      prerelease: false
    })
  });
  const rel = await createRes.json();
  console.log("Created release ID:", rel.id);

  // Upload .exe
  console.log("Uploading standalone .exe...");
  const exeBuf = fs.readFileSync("dist/aureal-watermark-win-x64.exe");
  await fetch("https://uploads.github.com/repos/KELLERBABG/Aureal-Watermark/releases/" + rel.id + "/assets?name=aureal-watermark-windows-x64.exe", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/octet-stream",
      "User-Agent": "NodeJS"
    },
    body: exeBuf
  });

  // Upload Windows zip
  console.log("Uploading windows zip...");
  const winZip = fs.readFileSync("dist/aureal-watermark-v0.2.1-windows-x64.zip");
  await fetch("https://uploads.github.com/repos/KELLERBABG/Aureal-Watermark/releases/" + rel.id + "/assets?name=aureal-watermark-v0.2.1-windows-x64.zip", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/zip",
      "User-Agent": "NodeJS"
    },
    body: winZip
  });

  // Upload Universal zip
  console.log("Uploading universal zip...");
  const univZip = fs.readFileSync("dist/aureal-watermark-v0.2.1-universal.zip");
  await fetch("https://uploads.github.com/repos/KELLERBABG/Aureal-Watermark/releases/" + rel.id + "/assets?name=aureal-watermark-v0.2.1-universal.zip", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/zip",
      "User-Agent": "NodeJS"
    },
    body: univZip
  });

  console.log("SUCCESS: Release v0.2.1 created and all assets attached!");
}

publishRelease().catch(console.error);
