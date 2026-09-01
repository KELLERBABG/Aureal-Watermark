// scripts/bundle.js — zero-dependency single-file bundler for Aureal Watermark Desktop & CLI

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

mkdirSync("dist", { recursive: true });

function stripImportsAndExports(code) {
  return code
    .replace(/^#!.*\n/, "")
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
let embedCode = stripImportsAndExports(readFileSync("src/embed.js", "utf8"));
let detectCode = stripImportsAndExports(readFileSync("src/detect.js", "utf8"));
let wavCode = stripImportsAndExports(readFileSync("src/wav.js", "utf8"));
let synthCode = stripImportsAndExports(readFileSync("src/synth.js", "utf8"));
let cliCode = stripImportsAndExports(readFileSync("bin/auralwatermark.js", "utf8"));

embedCode = embedCode.replace(/const DEFAULT_KEY = [^;]+;/g, "");
detectCode = detectCode.replace(/const DEFAULT_KEY = [^;]+;/g, "");

wavCode = wavCode.replace(/const\s+{\s*readFile\s*}\s*=\s*await import\("node:fs\/promises"\);/g, "const { readFile } = fsp;");
wavCode = wavCode.replace(/const\s+{\s*writeFile\s*}\s*=\s*await import\("node:fs\/promises"\);/g, "const { writeFile } = fsp;");

// Embed complete HTML inside getStudioHtml()
const rawStudioHtml = JSON.stringify(readFileSync("index.html", "utf8"));
cliCode = cliCode.replace(
  /function getStudioHtml\(\)\s*{[\s\S]*?return `[\s\S]*?`;\s*}/,
  `function getStudioHtml() { return ${rawStudioHtml}; }`
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
const { existsSync, readFileSync, mkdtempSync } = fs;
const { tmpdir } = os;

${signalCode}

${payloadCode}

${embedCode}

${detectCode}

${wavCode}

${synthCode}

${cliCode}
`;

writeFileSync("dist/cli.cjs", cjsBundle, "utf8");
console.log("Successfully generated dist/cli.cjs with embedded Desktop App Studio!");
