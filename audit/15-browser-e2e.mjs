// 15: real-browser end-to-end tests for both runtimes of the Studio page.
//
// Phase A — Desktop: builds the exact payload `auralwatermark gui` writes (adapted HTML +
//   ./assets) and loads it over file:// with the same flags the launcher uses. Checks that
//   the generated DSP engine and the offline LAME encoder load from disk, embed->detect
//   works, WAV and MP3 export produce real bytes, the export <select> is well formed and
//   nothing throws. This is the only check that exercises the browser.
//
// Phase B — Web: serves the repository over HTTP (the way Cloudflare Pages serves it) and
//   loads both the canonical page and the directory alias. Checks that the engine loads,
//   that the DSP Web Worker is actually constructed and used, and that both URL shapes
//   resolve the engine (the worker fetches the canonical /assets/ path on http).

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync, writeFileSync, mkdtempSync, existsSync, rmSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";

const ROOT = process.cwd();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findBrowser() {
  if (process.env.AUREAL_BROWSER) return process.env.AUREAL_BROWSER;
  const pf = process.env.ProgramFiles || "C:\\Program Files";
  const pf86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
  const local = process.env.LOCALAPPDATA || "";
  const candidates = [
    join(pf86, "Microsoft\\Edge\\Application\\msedge.exe"),
    join(pf, "Microsoft\\Edge\\Application\\msedge.exe"),
    join(local, "Microsoft\\Edge\\Application\\msedge.exe"),
    join(pf, "Google\\Chrome\\Application\\chrome.exe"),
    join(pf86, "Google\\Chrome\\Application\\chrome.exe"),
    join(local, "Google\\Chrome\\Application\\chrome.exe"),
    "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ];
  return candidates.find((p) => p && existsSync(p)) || null;
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.events = [];
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      } else if (msg.method) {
        this.events.push(msg);
      }
    };
  }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error("websocket error")); });
    return new Cdp(ws);
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression, awaitPromise = false) {
    const res = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise });
    if (res.exceptionDetails) {
      throw new Error("page exception: " + (res.exceptionDetails.exception?.description || res.exceptionDetails.text));
    }
    return res.result.value;
  }
  errors() {
    return this.events
      .filter((e) => e.method === "Runtime.exceptionThrown" || (e.method === "Log.entryAdded" && e.params.entry.level === "error"))
      .map((e) => e.method === "Runtime.exceptionThrown"
        ? (e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text)
        : e.params.entry.text)
      .filter((t) => !/Failed to load resource|Not allowed to load local resource|ERR_FILE_NOT_FOUND/i.test(t));
  }
}

/** Run `fn(cdp)` against `pageUrl` in a fresh headless browser; always tears down. */
async function withPage(label, pageUrl, fn) {
  const browser = findBrowser();
  const profile = mkdtempSync(join(tmpdir(), "aureal-profile-"));
  const child = spawn(browser, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--disable-extensions", "--mute-audio", "--window-size=1280,900",
    "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank",
  ], { stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  try {
    let port = 0;
    for (let i = 0; i < 150 && !port; i++) {
      try {
        const f = join(profile, "DevToolsActivePort");
        if (existsSync(f)) {
          const v = Number(readFileSync(f, "utf8").trim().split(/\r?\n/)[0]);
          if (v > 0) port = v;
        }
      } catch {}
      if (!port) await sleep(100);
    }
    if (!port) throw new Error("DevTools port did not appear");

    let target = null;
    for (let i = 0; i < 100; i++) {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      target = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (target) break;
      await sleep(100);
    }
    if (!target) throw new Error("page target not found");

    const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
    await cdp.send("Runtime.enable");
    await cdp.send("Log.enable");
    await cdp.send("Page.enable");

    // Navigate explicitly and wait for the navigation to commit + load, so the
    // evaluated context is the real page and not the initial about:blank.
    await cdp.send("Page.navigate", { url: pageUrl });
    let loaded = false;
    for (let i = 0; i < 200; i++) {
      const state = await cdp.evaluate("({ href: location.href, ready: document.readyState })").catch(() => null);
      if (state && state.href === pageUrl && state.ready === "complete") { loaded = true; break; }
      await sleep(100);
    }
    if (!loaded) throw new Error(`page did not finish loading (${pageUrl}); browser log:\n` + log.slice(0, 1500));
    await sleep(300);
    await fn(cdp);
    cdp.ws.close();
  } finally {
    child.kill();
    await sleep(400);
    try { rmSync(profile, { recursive: true, force: true }); } catch {}
  }
}

function buildDesktopPayload() {
  const src = readFileSync(join(ROOT, "bin", "auralwatermark.js"), "utf8");
  const cut = src.indexOf("async function main()");
  const head = src
    .slice(0, cut)
    .replace(/^#!.*\r?\n/, "")
    .replace(/^import\s+[^;]+;\s*$/gm, "")
    .replace(/import\.meta\.url/g, JSON.stringify("file:///" + ROOT.replace(/\\/g, "/") + "/bin/auralwatermark.js"));
  const nodeRequire = createRequire(ROOT + "/x.js");
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
  const dir = mkdtempSync(join(tmpdir(), "aureal-e2e-"));
  writeFileSync(join(dir, "studio.html"), api.adaptHtmlForOffline(api.getStudioHtml()), "utf8");
  writeFileSync(join(dir, "pricing.html"), api.adaptHtmlForOffline(api.getPricingHtml()), "utf8");
  api.writeEmbeddedIcons(dir);
  return dir;
}

/** Minimal static file server for the repo root (how Pages serves it). */
function serveRoot() {
  const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };
  const server = createServer((req, res) => {
    const url = decodeURIComponent(req.url.split("?")[0]);
    let file = resolve(ROOT, "." + normalize(url));
    if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    if (existsSync(file) && !file.endsWith("/")) {
      try {
        const body = readFileSync(file);
        res.writeHead(200, { "Content-Type": MIME[extname(file)] || "application/octet-stream" });
        res.end(body);
        return;
      } catch {}
    }
    res.writeHead(404, { "Content-Type": "text/plain" }).end("not found");
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r({ server, port: server.address().port })));
}

const checks = [];
const check = (name, pass, detail = "") => {
  checks.push({ name, pass: !!pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  [" + detail + "]" : ""}`);
};

async function phaseDesktop() {
  const desktop = buildDesktopPayload();
  const pageUrl = "file:///" + join(desktop, "studio.html").replace(/\\/g, "/");
  console.log("\n=== Phase A — Desktop Studio (file://) ===\n" + pageUrl);
  try {
    await withPage("desktop", pageUrl, async (cdp) => {
      const info = await cdp.evaluate(`({
        title: document.title,
        scripts: Array.from(document.scripts).map((s) => s.getAttribute("src") || ("inline:" + s.textContent.length)),
        engine: typeof window.AurealEngine,
        embed: typeof window.embedWatermarkCore,
        lame: typeof lamejs,
        encoder: typeof (typeof lamejs !== "undefined" ? lamejs.Mp3Encoder : undefined)
      })`);
      check("page loads and titles correctly", /Aureal/i.test(info.title), info.title);
      check("generated engine loaded from file://", info.engine === "object" && info.embed === "function", JSON.stringify(info.scripts));
      check("offline LAME encoder loaded from file://", info.lame === "function" && info.encoder === "function");

      const select = await cdp.evaluate(`(() => {
        const el = document.getElementById("export-format-select");
        return el ? { tag: el.tagName, options: el.options.length, attrs: Array.from(el.attributes).map((a) => a.name) } : null;
      })()`);
      check("export-format select is clean", select && select.tag === "SELECT" && select.options >= 5 && select.attrs.every((a) => a === "id"), JSON.stringify(select));

      const missing = await cdp.evaluate(`["detect-file","embed-file","detect-btn","embed-btn","btn-download","btn-rand-id","btn-open-license","tab-detect","tab-embed"].filter((id) => !document.getElementById(id))`);
      check("all Studio controls are present", missing.length === 0, "missing: " + missing.join(","));

      const rt = await cdp.evaluate(`(() => {
        const SR = 44100, N = SR * 5, pcm = new Float32Array(N * 2);
        for (let i = 0; i < N; i++) { const t = i / SR; const v = 0.4*Math.sin(2*Math.PI*220*t)+0.2*Math.sin(2*Math.PI*660*t)+0.1*Math.sin(2*Math.PI*1700*t); pcm[i*2]=v; pcm[i*2+1]=v; }
        const fmt = { sampleRate: SR, channels: 2 };
        const marked = embedWatermarkCore(pcm, fmt, { payloadId: 424242, key: "e2e", strength: 0.5 });
        const r = detectWatermarkCore(marked, fmt, { payloadId: 424242, key: "e2e" });
        const clean = detectWatermarkCore(pcm, fmt, { payloadId: 424242, key: "e2e" });
        return { detected: r.detected, id: r.recoveredPayloadId, conf: r.confidence, clean: clean.detected };
      })()`);
      check("embed -> detect works in the browser", rt.detected === true && rt.id === 424242, JSON.stringify(rt));
      check("unmarked audio is not falsely detected in-browser", rt.clean === false);

      const wav = await cdp.evaluate(`(() => { const N=88200, p=new Float32Array(N); for(let i=0;i<N;i++)p[i]=0.3*Math.sin(i/20); const b=encodeWavArray(p,44100,1,16); return { len:b.length, head:String.fromCharCode(...b.slice(0,4)) }; })()`, true);
      check("WAV export produces a RIFF file", wav.len > 1000 && wav.head === "RIFF", JSON.stringify(wav));

      const mp3 = await cdp.evaluate(`(async () => {
        const SR=44100, N=SR*2, pcm=new Float32Array(N*2);
        for (let i=0;i<N;i++){const t=i/SR;const v=0.35*Math.sin(2*Math.PI*261.63*t)+0.2*Math.sin(2*Math.PI*523.25*t);pcm[i*2]=v;pcm[i*2+1]=v;}
        const blob = encodeMp3Blob(pcm, SR, 2, 320);
        const buf = new Uint8Array(await blob.arrayBuffer());
        let sync=false; for(let i=0;i<Math.min(buf.length-1,4096);i++){ if(buf[i]===0xff && (buf[i+1]&0xe0)===0xe0){sync=true;break;} }
        return { size: blob.size, type: blob.type, sync };
      })()`, true);
      check("MP3 export produces a real MPEG stream", mp3.size > 5000 && mp3.sync, JSON.stringify(mp3));

      check("no uncaught page errors", cdp.errors().length === 0, cdp.errors().slice(0, 2).join(" | "));
    });
  } finally {
    rmSync(desktop, { recursive: true, force: true });
  }
}

async function phaseWeb() {
  const { server, port } = await serveRoot();
  console.log(`\n=== Phase B — Web Studio over HTTP (127.0.0.1:${port}) ===`);
  try {
    for (const [label, path] of [["canonical route", "/site/studio.html"], ["directory alias", "/site/studio/index.html"]]) {
      console.log(`-- ${label}: ${path}`);
      await withPage(label, `http://127.0.0.1:${port}${path}`, async (cdp) => {
        const info = await cdp.evaluate(`({
          href: location.href,
          title: document.title,
          bodyLen: document.body ? document.body.innerHTML.length : -1,
          contentType: document.contentType,
          engine: typeof window.AurealEngine,
          workerGlobal: typeof getDspWorker,
          workerWindow: typeof window.getDspWorker,
          embed: typeof embedWatermarkCore,
          detect: typeof detectWatermarkCore,
          scripts: Array.from(document.scripts).map((s) => s.getAttribute("src") || ("inline:" + s.textContent.length))
        })`);
        check(`${label}: engine loaded over HTTP`, info.engine === "object", JSON.stringify(info));

        const workerOk = await cdp.evaluate(`(async () => {
          const w = await getDspWorker();
          return { isWorker: typeof Worker !== "undefined" && !!w, srcOk: await fetch("/assets/aureal-engine.js").then(r => r.ok).catch(() => false) };
        })()`, true);
        check(`${label}: DSP worker source resolves`, workerOk.isWorker === true && workerOk.srcOk === true, JSON.stringify(workerOk));

        const viaWorker = await cdp.evaluate(`(async () => {
          const SR=44100, N=SR*4, pcm=new Float32Array(N*2);
          for (let i=0;i<N;i++){const t=i/SR;const v=0.4*Math.sin(2*Math.PI*200*t)+0.2*Math.sin(2*Math.PI*800*t);pcm[i*2]=v;pcm[i*2+1]=v;}
          const fmt={sampleRate:SR,channels:2};
          const marked = embedWatermarkCore(pcm, fmt, { payloadId: 777777, key: "web" });
          const r = await asyncDetect(marked, fmt, { payloadId: 777777, key: "web" });
          return { detected: r.detected, id: r.recoveredPayloadId, workerAlive: !!dspWorkerInstance };
        })()`, true);
        check(`${label}: detect through the Web Worker`, viaWorker.detected === true && viaWorker.id === 777777 && viaWorker.workerAlive === true, JSON.stringify(viaWorker));

        check(`${label}: no uncaught page errors`, cdp.errors().length === 0, cdp.errors().slice(0, 2).join(" | "));
      });
    }
  } finally {
    server.close();
  }
}

async function main() {
  if (!findBrowser()) { console.log("SKIP: no Chrome/Edge found"); return; }
  await phaseDesktop();
  await phaseWeb();
  const bad = checks.filter((c) => !c.pass).length;
  console.log(`\n${checks.length - bad}/${checks.length} passed`);
  if (bad > 0) process.exitCode = 1;
}

main().catch((err) => { console.error("E2E error:", err.message); process.exitCode = 1; });
