// End-to-end test of lineage-first entry (register/ "#lineage=1" + hero buttons) against a LOCAL hardhat node (never a testnet/mainnet).
// Run: node test/e2e-lineage-hash.js   (needs: npm i, npx hardhat compile, Microsoft Edge). Do not run at the same time as the other e2e files (same ports).
// Agent #1 is SYNTHETIC with 8 versions (v1..v8), standing in for the real Ieum record; only the display path is checked.
const fs = require("fs");
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const { spawn } = require("child_process");
const { ethers } = require("ethers");
const { chromium } = require("playwright-core");

const ROOT = path.join(__dirname, "..");
const REG_DIR = path.join(ROOT, "register");
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const RPC = "http://127.0.0.1:8545";
const KEY0 = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const config = fs.readFileSync(path.join(REG_DIR, "config.js"), "utf8");
const REGISTRY = config.match(/localhost:[\s\S]*?registry: "(0x[0-9a-fA-F]{40})"/)[1];
const sha = (s) => "0x" + crypto.createHash("sha256").update(s).digest("hex");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail !== undefined ? "  -> " + detail : ""}`); }
}
async function waitRpc() {
  const p = new ethers.JsonRpcProvider(RPC);
  for (let i = 0; i < 480; i++) { try { await p.getBlockNumber(); return p; } catch { await sleep(500); } }
  throw new Error("hardhat node did not start");
}
function serveStatic() {
  const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css", ".md": "text/plain" };
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
  const node = spawn(process.execPath, [path.join(ROOT, "node_modules", "hardhat", "internal", "cli", "bootstrap.js"), "node"], { cwd: ROOT, stdio: "ignore" });
  const server = await serveStatic();
  let browser;
  try {
    const provider = await waitRpc();
    const art = JSON.parse(fs.readFileSync(path.join(ROOT, "artifacts", "contracts", "SoulRegistry.sol", "SoulRegistry.json"), "utf8"));
    const signer = new ethers.NonceManager(new ethers.Wallet(KEY0, provider));
    const dep = await new ethers.ContractFactory(art.abi, art.bytecode, signer).deploy();
    await dep.waitForDeployment();
    check("local deploy address equals config.js localhost address", (await dep.getAddress()) === REGISTRY);
    const reg = new ethers.Contract(REGISTRY, art.abi, signer);
    await (await reg.registerAgent("Synthetic-Ieum", "synthetic", "")).wait();
    const H = [];
    let parent = ethers.ZeroHash;
    for (let i = 1; i <= 8; i++) {
      const h = sha("synthetic ieum v" + i);
      await (await reg.appendSoul(1, h, parent, "synthetic note " + i)).wait();
      H.push(h); parent = h;
    }
    check("setup: agent #1 has 8 versions", (await reg.getHistory(1)).length === 8);

    browser = await chromium.launch({ executablePath: EDGE, headless: true });
    const mk = async (viewport) => {
      const ctx = await browser.newContext({ viewport, locale: "ko-KR" });
      const page = await ctx.newPage();
      page.on("pageerror", (e) => console.log("  [pageerror]", e.message));
      return { ctx, page };
    };

    console.log("[ui] open with #lineage=1 (no input)");
    const { ctx, page } = await mk({ width: 1280, height: 900 });
    await page.goto("http://127.0.0.1:4173/?net=localhost#lineage=1");
    await page.waitForSelector("#linAgent1");
    check("lineage tab is selected and visible", (await page.locator("#tab-tree").getAttribute("aria-selected")) === "true" && (await page.locator("#panel-tree").isVisible()));
    check("8 nodes v1..v8 drawn", (await page.locator("#linAgent1 > .lin-chain > .lin-node").count()) === 8 && /^v8/.test(await page.locator("#linNode1v8").innerText()));
    const n1 = await page.locator("#linNode1v1").innerText();
    check("node card shows date, 10-hex hash and note", /UTC/.test(n1) && n1.includes(H[0].slice(2, 12)) && !n1.includes(H[0].slice(2, 13)) && /synthetic note 1/.test(n1), n1);
    check("only v8 carries the latest badge", (await page.locator("#linAgent1 .lin-node .badge").count()) === 1 && /최신/.test(await page.locator("#linNode1v8").innerText()));
    check("details are collapsed at first", (await page.locator(".lin-detail:visible").count()) === 0);
    await page.click("#linNode1v2 .lin-toggle");
    const d2 = await page.locator("#linDetail1v2").innerText();
    check("v2 detail: full hash and parent hash (= v1 hash)", d2.includes(H[1]) && d2.includes(H[0]), d2);
    await page.waitForFunction(() => !/찾는 중/.test(document.getElementById("linTx1v2").textContent));
    check("v2 detail: recording tx found (local chain: plain hash, no explorer link)", /0x[0-9a-f]{10}/.test(await page.locator("#linTx1v2").innerText()));
    await page.click("#linNode1v1 .lin-toggle");
    check("v1 detail: parent shown as 'none · first version'", /첫 버전/.test(await page.locator("#linDetail1v1").innerText()));
    await page.click("#linNode1v2 .lin-toggle");
    check("clicking again collapses the detail", !(await page.locator("#linDetail1v2").isVisible()));
    check("hero is on the page with the 4 steps and 2 buttons", (await page.locator(".hero-steps li").count()) === 4 && (await page.locator("#heroLineage").isVisible()) && (await page.locator("#heroCheck").isVisible()));
    check("notice 'what the ledger does not tell you' is kept", /장부가 말해 주지 않는 것/.test(await page.locator(".notice").innerText()));
    await ctx.close();

    console.log("[ui] hero buttons from the plain URL");
    const b = await mk({ width: 1280, height: 900 });
    await b.page.goto("http://127.0.0.1:4173/?net=localhost");
    await b.page.waitForSelector("#heroLineage");
    check("plain URL: default tab is not the lineage tab", (await b.page.locator("#tab-direct").getAttribute("aria-selected")) === "true");
    await b.page.click("#heroLineage");
    await b.page.waitForSelector("#linAgent1");
    check("hero button opens lineage with 8 nodes and sets #lineage=1", (await b.page.locator("#linAgent1 > .lin-chain > .lin-node").count()) === 8 && (await b.page.evaluate(() => location.hash)) === "#lineage=1");
    await b.page.click('[data-lang="en"]');
    check("en: hero text and latest badge", /Fingerprint \(SHA-256\)/.test(await b.page.locator(".hero-steps").innerText()) && /latest/.test(await b.page.locator("#linNode1v8").innerText()));
    await b.page.click("#heroCheck");
    check("hero 'check my SOUL' opens the lookup tab", (await b.page.locator("#tab-lookup").getAttribute("aria-selected")) === "true");
    await b.ctx.close();

    console.log("[ui] mobile 390x844");
    const m = await mk({ width: 390, height: 844 });
    await m.page.goto("http://127.0.0.1:4173/?net=localhost#lineage=1");
    await m.page.waitForSelector("#linAgent1");
    await m.page.click("#linNode1v8 .lin-toggle");
    check("mobile: no horizontal overflow, 8 nodes", (await m.page.evaluate(() => document.documentElement.scrollWidth)) <= 390 && (await m.page.locator("#linAgent1 > .lin-chain > .lin-node").count()) === 8);
    await m.ctx.close();
  } finally {
    if (browser) await browser.close();
    server.close();
    node.kill();
  }
  console.log(`\nLineage-hash E2E result: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
