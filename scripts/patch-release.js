// scripts/patch-release.js — cleanly updates GitHub Release notes with perfect UTF-8 encoding

const token = "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";

const body = `# Aureal Watermark v0.2.0 — Production Release

Inaudible spread-spectrum acoustic watermarking and provenance detection engine.

### Highlights & Features
* **Zero External Dependencies:** Built with pure ESM JavaScript and standard Node.js / Web Audio APIs (0 npm packages).
* **Lossy Codec Resilience:** Verified to survive MP3 (128k/320k) and AAC (128k) re-encoding cycles.
* **Dual-Platform:** Fast CLI for servers/terminals and an offline Web Studio for browsers.
* **Dual License:** Free for personal and academic use (PolyForm Noncommercial 1.0.0); paid commercial license for businesses.

### Downloads & Assets

| File | Platform | Description |
| :--- | :--- | :--- |
| **\`aureal-watermark-windows-x64.exe\`** | Windows (x64) | **Direct executable** — runs instantly from Command Prompt or PowerShell (no Node.js or installation needed). |
| **\`aureal-watermark-v0.2.0-windows-x64.zip\`** | Windows (x64) | Standalone \`.exe\` + offline Web Studio (\`studio.html\`) + documentation. |
| **\`aureal-watermark-v0.2.0-universal.zip\`** | All (Linux/macOS/Win) | Cross-platform bundle (\`aureal-watermark.cjs\`) for systems with Node.js ≥ 18 + offline Web Studio. |

---

### Quick CLI Usage (Windows Executable)

\`\`\`powershell
# 1. Embed tracking ID into an audio file
.\\aureal-watermark.exe embed master.wav tagged.wav --id 883921

# 2. Verify an expected ID
.\\aureal-watermark.exe detect tagged.wav --id 883921

# 3. Blind detection (extracts ID automatically)
.\\aureal-watermark.exe detect unknown.wav --json
\`\`\`

Online Studio: https://kellerbabg.github.io/Aureal-Watermark/
`;

async function updateRelease() {
  const getRes = await fetch("https://api.github.com/repos/KELLERBABG/Aureal-Watermark/releases/tags/v0.2.0", {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "NodeJS",
    },
  });

  const rel = await getRes.json();
  if (!rel.id) {
    console.error("Failed to find release:", rel);
    process.exit(1);
  }

  console.log(`Found release ID: ${rel.id}`);

  const patchRes = await fetch(`https://api.github.com/repos/KELLERBABG/Aureal-Watermark/releases/${rel.id}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json; charset=utf-8",
      "User-Agent": "NodeJS",
    },
    body: JSON.stringify({
      name: "Aureal Watermark v0.2.0",
      body: body,
    }),
  });

  const updated = await patchRes.json();
  console.log("Successfully updated release notes cleanly in UTF-8!");
}

updateRelease().catch(console.error);
