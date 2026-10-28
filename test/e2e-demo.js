// E2E of the "one-character experiment" demo + use cards on the register landing page (no chain needed; headless Edge).
// Run: node test/e2e-demo.js                      (local static server on :4173)
//      node test/e2e-demo.js https://ieum-ledger.pages.dev   (live site; also saves docs/register/demo-ko-live.png, use-cards-mobile-390-live.png)
const fs = require("fs");
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const { chromium } = require("playwright-core");

const ROOT = path.join(__dirname, "..");
const REG_DIR = path.join(ROOT, "register");
const SHOTS = path.join(ROOT, "docs", "register");
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const LIVE = process.argv[2];
const sha = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail !== undefined ? "  -> " + detail : ""}`); }
}
function serveStatic() {
  const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css", ".md": "text/plain", ".png": "image/png" };
  const srv = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url.split("?")[0]);
    const f = path.join(REG_DIR, u === "/" ? "index.html" : u);
    if (!f.startsWith(REG_DIR) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" });
    res.end(fs.readFileSync(f));
  });
  return new Promise((r) => srv.listen(4173, "127.0.0.1", () => r(srv)));
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  const demoSrc = fs.readFileSync(path.join(REG_DIR, "demo.js"), "utf8").replace(/\/\/.*$/gm, "");
  check("static: demo.js has no fetch/XHR/WebSocket/sendBeacon", !/\b(fetch|XMLHttpRequest|sendBeacon|WebSocket|EventSource)\b/.test(demoSrc));
  const server = LIVE ? null : await serveStatic();
  const base = LIVE || "http://127.0.0.1:4173";
  const browser = await chromium.launch({ executablePath: EDGE, headless: true });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 }, locale: "ko-KR" });
    const page = await ctx.newPage();
    const requests = [];
    page.on("request", (r) => requests.push({ url: r.url(), method: r.method() }));
    page.on("pageerror", (e) => console.log("  [pageerror]", e.message));
    await page.goto(base + "/");
    await page.waitForSelector("#demoText");
    const status = () => page.locator("#demoStatus").innerText();
    const waitStatus = (s) => page.waitForFunction((x) => document.getElementById("demoStatus").dataset.state === x, s, { timeout: 5000 });

    const sample = await page.inputValue("#demoText");
    check("demo(ko): sample text is prefilled", sample.includes("운종님"), sample);
    await waitStatus("same");
    check("demo(ko): initially '같음'", (await status()) === "같음", await status());
    const hexOrig = (await page.locator("#demoOrig").innerText()).trim();
    check("demo: original fingerprint equals node SHA-256 of the sample", hexOrig === sha(sample), hexOrig);

    // change one character
    await page.fill("#demoText", sample.replace("운종님", "운종닙"));
    await waitStatus("diff");
    check("demo: one-character change -> '달라짐!'", (await status()) === "달라짐!", await status());
    const hexNow = (await page.locator("#demoCur").innerText()).trim();
    check("demo: current fingerprint equals node SHA-256 of the edited text", hexNow === sha(sample.replace("운종님", "운종닙")));
    const marked = await page.locator("#demoCur .dh").count();
    let expected = 0; for (let i = 0; i < 64; i++) if (hexNow[i] !== hexOrig[i]) expected++;
    check("demo: differing hex digits are highlighted", marked === expected && marked > 20, `${marked}/${expected}`);

    // restore
    await page.fill("#demoText", sample);
    await waitStatus("same");
    check("demo: restoring the original -> '같음'", (await status()) === "같음");
    check("demo: no highlighted digits when same", (await page.locator("#demoCur .dh").count()) === 0);

    // reset button
    await page.fill("#demoText", sample + "x");
    await waitStatus("diff");
    await page.click("#demoReset");
    await waitStatus("same");
    check("demo: reset button restores the sample", (await page.inputValue("#demoText")) === sample);

    // cards
    check("cards: 3 use cards, each with an evidence link to the Zenodo DOI", (await page.locator(".use-card").count()) === 3 && (await page.locator(".use-card a[href='https://doi.org/10.5281/zenodo.23653775']").count()) === 3);
    check("cards: card 2 shows the check-soul command", (await page.locator(".use-card .cmd").innerText()).includes("check-soul.js"));
    check("demo sits above the cards, cards above the notice", await page.evaluate(() => {
      const y = (s) => document.querySelector(s).getBoundingClientRect().top;
      return y(".hero") < y(".demo") && y(".demo") < y(".uses") && y(".uses") < y(".notice");
    }));
    if (LIVE) await page.locator(".demo").screenshot({ path: path.join(SHOTS, "demo-ko-live.png") });

    // English
    await page.click("button.seg[data-lang=en]");
    await page.waitForFunction(() => document.getElementById("demoStatus").textContent === "Same", null, { timeout: 5000 });
    const sampleEn = await page.inputValue("#demoText");
    check("demo(en): sample switches to English", sampleEn.includes("Woonjong"), sampleEn);
    await page.fill("#demoText", sampleEn.replace("Woonjong", "Woonjung"));
    await page.waitForFunction(() => document.getElementById("demoStatus").textContent === "Changed!", null, { timeout: 5000 });
    check("demo(en): one-character change -> 'Changed!'", true);
    check("cards(en): titles in English", (await page.locator(".use-card h3").first().innerText()).startsWith("If your AI"));
    check("cards(en): wording stays within limits (no 'proves behaviour' claim)", !/prove/i.test(await page.locator(".uses").innerText()));

    // no network beyond page origin for the demo itself: nothing POSTed
    check("network: no non-GET requests", requests.every((r) => r.method === "GET"), JSON.stringify(requests.filter((r) => r.method !== "GET")));
    await ctx.close();

    // mobile
    const m = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "ko-KR" });
    const mp = await m.newPage();
    await mp.goto(base + "/");
    await mp.waitForSelector("#demoText");
    await mp.waitForFunction(() => document.getElementById("demoStatus").dataset.state === "same");
    await mp.fill("#demoText", "x");
    await mp.waitForFunction(() => document.getElementById("demoStatus").dataset.state === "diff");
    check("mobile 390: no horizontal overflow", (await mp.evaluate(() => document.documentElement.scrollWidth)) <= 390, await mp.evaluate(() => document.documentElement.scrollWidth));
    check("mobile 390: hash lines and cards fit the viewport", await mp.evaluate(() => [...document.querySelectorAll(".hex,.use-card,.cmd,.demo")].every((n) => n.getBoundingClientRect().right <= window.innerWidth + 1)));
    await mp.fill("#demoText", sample);
    await mp.waitForFunction(() => document.getElementById("demoStatus").dataset.state === "same");
    if (LIVE) await mp.locator(".uses").screenshot({ path: path.join(SHOTS, "use-cards-mobile-390-live.png") });
    else await mp.locator(".uses").screenshot({ path: path.join(SHOTS, "use-cards-mobile-390.png") });
    await m.close();
  } finally {
    await browser.close();
    if (server) server.close();
  }
  console.log(`\nDemo E2E result: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
