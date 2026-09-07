// scripts/bundle.js — zero-dependency single-file bundler for Aureal Watermark Desktop & CLI

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

mkdirSync("dist", { recursive: true });

function stripImportsAndExports(code) {
  return code
    .replace(/^#!.*(\r?\n)+/gm, "")
    .replace(/export\s+{[^}]+}\s+from\s+["'][^"']+["'];?/g, "")
    .replace(/import\s+{[^}]+}\s+from\s+["'][^"']+["'];?/g, "")
    .replace(/import\s+[^;]+from\s+["'][^"']+["'];?/g, "")
    .replace(/export\s+{[^}]+};?/g, "")
    .replace(/export\s+const\s+/g, "const ")
    .replace(/export\s+(async\s+)?function\s+/g, "$1function ")
    .replace(/export\s+class\s+/g, "class ")
    .replace(/export\s+default\s+/g, "")
    .trim();
}

let signalCode = stripImportsAndExports(readFileSync("src/signal.js", "utf8"));
let payloadCode = stripImportsAndExports(readFileSync("src/payload.js", "utf8"));
let resampleCode = stripImportsAndExports(readFileSync("src/resample.js", "utf8"));
let embedCode = stripImportsAndExports(readFileSync("src/embed.js", "utf8"));
let detectCode = stripImportsAndExports(readFileSync("src/detect.js", "utf8"));
let wavCode = stripImportsAndExports(readFileSync("src/wav.js", "utf8"));
let synthCode = stripImportsAndExports(readFileSync("src/synth.js", "utf8"));
let cliCode = stripImportsAndExports(readFileSync("bin/auralwatermark.js", "utf8"));

embedCode = embedCode.replace(/const DEFAULT_KEY = [^;]+;/g, "");
detectCode = detectCode.replace(/const DEFAULT_KEY = [^;]+;/g, "");

wavCode = wavCode.replace(/const\s+{\s*readFile\s*}\s*=\s*await import\("node:fs\/promises"\);/g, "const { readFile } = fsp;");
wavCode = wavCode.replace(/const\s+{\s*writeFile\s*}\s*=\s*await import\("node:fs\/promises"\);/g, "const { writeFile } = fsp;");

// Embed complete HTML inside getStudioHtml() and getPricingHtml()
const rawStudioHtml = JSON.stringify(readFileSync("studio.html", "utf8"));
const rawPricingHtml = JSON.stringify(readFileSync("pricing.html", "utf8"));
const rawIconIcoBase64 = JSON.stringify(readFileSync("assets/icon.ico").toString("base64"));
const rawIconPngBase64 = JSON.stringify(readFileSync("assets/icon.png").toString("base64"));
const rawIconSvgBase64 = JSON.stringify(readFileSync("assets/icon.svg").toString("base64"));
const rawFaviconSvgBase64 = JSON.stringify(readFileSync("assets/favicon.svg").toString("base64"));

cliCode = cliCode.replace(
  /function getStudioHtml\(\)\s*{[\s\S]*?return `[\s\S]*?`;\s*}/,
  `function getStudioHtml() { return ${rawStudioHtml}; }`
);
cliCode = cliCode.replace(
  /function getPricingHtml\(\)\s*{[\s\S]*?return "";\s*}/,
  `function getPricingHtml() { return ${rawPricingHtml}; }`
);
cliCode = cliCode.replace(
  /function writeEmbeddedIcons\(targetDir\)\s*{[\s\S]*?^}/m,
  `function writeEmbeddedIcons(targetDir) {
  try {
    const icoBuf = Buffer.from(${rawIconIcoBase64}, "base64");
    const pngBuf = Buffer.from(${rawIconPngBase64}, "base64");
    const iconSvgBuf = Buffer.from(${rawIconSvgBase64}, "base64");
    const svgBuf = Buffer.from(${rawFaviconSvgBase64}, "base64");
    writeFileSync(join(targetDir, "favicon.ico"), icoBuf);
    writeFileSync(join(targetDir, "icon.png"), pngBuf);
    writeFileSync(join(targetDir, "favicon.svg"), svgBuf);
    writeFileSync(join(targetDir, "icon.svg"), iconSvgBuf);
    const assetsDir = join(targetDir, "assets");
    if (!existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });
    writeFileSync(join(assetsDir, "icon.ico"), icoBuf);
    writeFileSync(join(assetsDir, "icon.png"), pngBuf);
    writeFileSync(join(assetsDir, "icon.svg"), iconSvgBuf);
    writeFileSync(join(assetsDir, "favicon.svg"), svgBuf);
    writeFileSync(join(assetsDir, "logo.svg"), iconSvgBuf);
  } catch {}
}`
);

const cjsBundle = `#!/usr/bin/env node
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const process = require("node:process");
const os = require("node:os");
const { spawn, exec } = require("node:child_process");
const { createServer } = require("node:http");
const { join, dirname } = require("node:path");

const { argv, exit, stdin, stdout } = process;
const { readFile, writeFile } = fsp;
const { existsSync, readFileSync, writeFileSync, mkdtempSync, mkdirSync, copyFileSync } = fs;
const { tmpdir } = os;

const DEFAULT_KEY = "aural-watermark-default-key";

${signalCode}

${payloadCode}

${resampleCode}

${embedCode}

${detectCode}

${wavCode}

${synthCode}

${cliCode}
`;

writeFileSync("dist/cli.cjs", cjsBundle, "utf8");
console.log("Successfully generated dist/cli.cjs with embedded Desktop App Studio!");
