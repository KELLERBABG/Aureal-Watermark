// 11: Desktop Studio offline packaging — link rewriting, asset shipping, licence preseed
import { readFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Evaluate the real helper functions from bin/auralwatermark.js without running main().
const src = readFileSync("bin/auralwatermark.js", "utf8");
const cut = src.indexOf("async function main()");
const head = src
  .slice(0, cut)
  .replace(/^#!.*\r?\n/, "")
  .replace(/^import\s+[^;]+;\s*$/gm, "")
  .replace(/import\.meta\.url/g, JSON.stringify("file:///" + process.cwd().replace(/\\/g, "/") + "/bin/auralwatermark.js"));

const { createRequire } = await import("node:module");
const nodeRequire = createRequire(process.cwd() + "/x.js");
const prelude = `
const { argv, exit } = process;
const { spawn, execFile, execFileSync } = require("node:child_process");
const { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, unlinkSync } = require("node:fs");
const { join, dirname } = require("node:path");
const { tmpdir } = require("node:os");
const { fileURLToPath } = require("node:url");
`;
const api = new Function("require", "process", "console", `${prelude}
${head}
return { adaptHtmlForOffline, getStudioHtml, getPricingHtml, writeEmbeddedIcons };`)(nodeRequire, process, console);

const results = [];
const ok = (n, c, d = "") => results.push({ n, c: !!c, d });

const studio = api.getStudioHtml();
ok("getStudioHtml() returns the real studio page", studio.includes("Aureal Watermark") && studio.length > 40000, studio.length + " chars");
ok("studio contains the preseeded licence marker", studio.includes("/*__AUREAL_PRESEEDED_LICENSE__*/"));
ok("studio references the generated engine", studio.includes('src="/assets/aureal-engine.js"'));
ok("getPricingHtml() returns the pricing page", api.getPricingHtml().length > 20000);

const off = api.adaptHtmlForOffline(studio);
ok("offline: /pricing links rewritten to pricing.html", !/href\s*=\s*"\/pricing\b/.test(off) && off.includes('href="pricing.html"'));
ok("offline: root link neutralised", !off.includes('href="/"'));
ok("offline: no site-absolute hrefs remain", !/href\s*=\s*"\/[^"]*"/.test(off));
ok("offline: no site-absolute src remains", !/src\s*=\s*"\/[^"]*"/.test(off),
  (off.match(/src\s*=\s*"\/[^"]*"/g) || []).join(", "));
ok("offline: engine src is relative", off.includes('src="assets/aureal-engine.js"'));
ok("offline: MP3 encoder src is relative", off.includes('src="assets/lame.min.js"'));

process.env.AUREAL_SITE_BASE_URL = "https://aureal.kellersystems.dev";
const off2 = api.adaptHtmlForOffline(studio);
ok("offline (with base url): nav links point at the site", /href="https:\/\/aureal\.kellersystems\.dev\/docs"/.test(off2));
ok("offline (with base url): engine src stays local", off2.includes('src="assets/aureal-engine.js"'));
delete process.env.AUREAL_SITE_BASE_URL;

// Actually write the offline payload the way launchDesktopApp() does and check the files exist.
const dir = mkdtempSync(join(tmpdir(), "aureal-desktop-"));
try {
  api.writeEmbeddedIcons(dir);
  ok("writeEmbeddedIcons ships assets/aureal-engine.js", existsSync(join(dir, "assets", "aureal-engine.js")));
  ok("writeEmbeddedIcons ships assets/lame.min.js", existsSync(join(dir, "assets", "lame.min.js")));
  ok("writeEmbeddedIcons ships the icons", existsSync(join(dir, "favicon.ico")) && existsSync(join(dir, "icon.png")));
} finally {
  rmSync(dir, { recursive: true, force: true });
}

// Licence preseed: the injected record has no `key`, so the page must accept it anyway.
const studioSrc = readFileSync("site/studio.html", "utf8");
ok("studio no longer requires .key on the preseeded licence",
  !/__AUREAL_PRESEEDED_LICENSE__\s*&&\s*window\.__AUREAL_PRESEEDED_LICENSE__\.key/.test(studioSrc));
const accepts = (p) => !!(p && (p.displayKey || p.status === "granted" || p.status === "active"));
ok("preseeded licence {status:active, displayKey} is accepted", accepts({ status: "active", displayKey: "****-ABCDEFGH" }));
ok("empty preseeded licence is ignored", !accepts(null) && !accepts({}));

for (const r of results) console.log(`${r.c ? "PASS" : "FAIL"}  ${r.n}${r.d ? "  [" + r.d + "]" : ""}`);
console.log(`\n${results.filter((r) => r.c).length}/${results.length} passed`);
