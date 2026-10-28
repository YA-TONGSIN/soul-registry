// Screenshots of the register page via headless Edge (read-only; the page only reads the public chain RPC).
// Usage: node scripts/shots.js og                         -> register/og-image.png (1200x630) from a local static server (Base Sepolia, Agent #1)
//        node scripts/shots.js live https://ieum-ledger.pages.dev  -> docs/register/{home-ko,lineage-ko,lineage-mobile}-live.png
const fs = require("fs");
const path = require("path");
const http = require("http");
const { chromium } = require("playwright-core");

const ROOT = path.join(__dirname, "..");
const REG_DIR = path.join(ROOT, "register");
const SHOTS = path.join(ROOT, "docs", "register");
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

function serveStatic() {
  const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css", ".png": "image/png" };
  const srv = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url.split("?")[0]);
    const f = path.join(REG_DIR, u === "/" ? "index.html" : u);
    if (!f.startsWith(REG_DIR) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" });
    res.end(fs.readFileSync(f));
  });
  return new Promise((r) => srv.listen(4173, "127.0.0.1", () => r(srv)));
}
async function lineagePage(browser, base, viewport, bypassCSP) {
  const ctx = await browser.newContext({ viewport, locale: "ko-KR", bypassCSP: !!bypassCSP });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));
  await page.goto(base + "/#lineage=1");
  await page.waitForSelector("#linAgent1 .lin-node", { timeout: 60000 });
  return { ctx, page };
}

async function main() {
  const mode = process.argv[2];
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch({ executablePath: EDGE, headless: true });
  try {
    if (mode === "og") {
      const server = await serveStatic();
      const { ctx, page } = await lineagePage(browser, "http://127.0.0.1:4173", { width: 1200, height: 630 }, true);
      await page.addStyleTag({ content: "body{zoom:.72}.og-banner{position:fixed;left:0;right:0;top:0;height:120px;z-index:99;background:#3b2f94;color:#fff;padding:20px 44px;zoom:1}.og-banner b{display:block;font-size:40px;line-height:1.2}.og-banner span{font-size:22px;opacity:.9}" });
      await page.evaluate(() => {
        const d = document.createElement("div");
        d.className = "og-banner";
        d.innerHTML = "<b>이음 장부 · AI의 SOUL 버전 계보</b><span>SOUL 파일 → 지문(SHA-256) → 장부에 버전 기록 → 계보로 보기 — 공개되는 것은 해시와 한 줄 메모뿐</span>";
        document.body.append(d);
        const r = document.getElementById("linAgent1").getBoundingClientRect();
        window.scrollTo(0, window.scrollY + r.top - 100);
      });
      await page.screenshot({ path: path.join(REG_DIR, "og-image.png"), clip: { x: 0, y: 0, width: 1200, height: 630 } });
      await ctx.close(); server.close();
      console.log("wrote register/og-image.png");
    } else if (mode === "live") {
      const base = process.argv[3].replace(/\/$/, "");
      const home = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "ko-KR" });
      const hp = await home.newPage();
      await hp.goto(base + "/");
      await hp.waitForSelector("#heroLineage");
      await hp.screenshot({ path: path.join(SHOTS, "home-ko-live.png") });
      await home.close();
      const d = await lineagePage(browser, base, { width: 1280, height: 900 });
      const n = await d.page.locator("#linAgent1 > .lin-chain > .lin-node").count();
      console.log("live desktop nodes:", n, "| versions:", (await d.page.locator("#linAgent1 > .lin-chain > .lin-node > .lin-toggle b").allInnerTexts()).join(","));
      await d.page.click("#linNode1v8 .lin-toggle");
      await d.page.waitForFunction(() => !/찾는 중/.test(document.getElementById("linTx1v8").textContent), null, { timeout: 60000 });
      console.log("v8 tx slot:", await d.page.locator("#linTx1v8").innerText(), "| link:", await d.page.locator("#linTx1v8 a").getAttribute("href"));
      await d.page.screenshot({ path: path.join(SHOTS, "lineage-ko-live.png"), fullPage: true });
      await d.ctx.close();
      const m = await lineagePage(browser, base, { width: 390, height: 844 });
      console.log("live mobile nodes:", await m.page.locator("#linAgent1 > .lin-chain > .lin-node").count(), "| overflow:", await m.page.evaluate(() => document.documentElement.scrollWidth > 390));
      await m.page.screenshot({ path: path.join(SHOTS, "lineage-mobile-live.png"), fullPage: true });
      await m.ctx.close();
    } else throw new Error("usage: og | live <url>");
  } finally { await browser.close(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
