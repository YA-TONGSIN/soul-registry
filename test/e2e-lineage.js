// End-to-end test of the lineage tree (register/ "계보" tab) against a LOCAL hardhat node (never a testnet/mainnet).
// Run: node test/e2e-lineage.js        (needs: npm i, npx hardhat compile, Microsoft Edge). Do not run at the same time as e2e-register.js (same ports).
// All agents/hashes/notes are SYNTHETIC (no real SOUL content). Keys are hardhat's public default test key #0.
const fs = require("fs");
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const { spawn } = require("child_process");
const { ethers } = require("ethers");
const { chromium } = require("playwright-core");

const ROOT = path.join(__dirname, "..");
const REG_DIR = path.join(ROOT, "register");
const SHOTS = path.join(ROOT, "docs", "register");
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
  fs.mkdirSync(SHOTS, { recursive: true });
  const src = fs.readFileSync(path.join(REG_DIR, "lineage.js"), "utf8") + fs.readFileSync(path.join(REG_DIR, "app.js"), "utf8");
  check("static: lineage code has no fetch/XHR/WebSocket/sendBeacon and no external <script>", !/\b(fetch|XMLHttpRequest|sendBeacon|WebSocket|EventSource)\b/.test(src.replace(/\/\*[\s\S]*?\*\//g, "")) && !/<script[^>]+src="https?:/.test(fs.readFileSync(path.join(REG_DIR, "index.html"), "utf8")));

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
    const send = async (p) => (await p).wait();

    // SYNTHETIC data. A (id 1): v1..v3, scores on v1 (2) and v3 (1). B (id 2): forks A@v2 (note). C (id 3): forks A@v2 (metaURI).
    // D (id 4): forks B@v1. E (id 5): claims A@v9 (a version that does not exist). F (id 6): unrelated.
    const H = {};
    const addAgent = async (name, note, uri, versions) => {
      await send(reg.registerAgent(name, note, uri));
      let parent = ethers.ZeroHash;
      const id = Number(await reg.agentCount());
      for (let i = 0; i < versions.length; i++) {
        const h = sha(`synthetic ${name} v${i + 1}`);
        await send(reg.appendSoul(id, h, parent, versions[i]));
        H[name.replace("Synthetic-", "") + (i + 1)] = h; parent = h;
      }
      return id;
    };
    await addAgent("Synthetic-A", "synthetic origin", "", ["A first", "A second", "A third"]);
    await addAgent("Synthetic-B", "branch fork-of:1@v2", "", ["B first"]);
    await addAgent("Synthetic-C", "metaURI fork", "ipfs://synthetic fork-of:1@v2", ["C first", "C second"]);
    await addAgent("Synthetic-D", "fork-of:2@v1", "", ["D first"]);
    await addAgent("Synthetic-E", "fork-of:1@v9", "", ["E first"]);
    await addAgent("Synthetic-F", "unrelated", "", ["F first"]);
    await send(reg.recordCarryOver(1, H.A1, "synthetic-m1", "synthetic-m2", sha("r1"), 8123));
    await send(reg.recordCarryOver(1, H.A1, "synthetic-m2", "synthetic-m3", sha("r2"), 5000));
    await send(reg.recordCarryOver(1, H.A3, "synthetic-m1", "synthetic-m3", sha("r3"), 9000));
    check("setup: 6 agents on the local chain, A has 3 versions", Number(await reg.agentCount()) === 6 && (await reg.getHistory(1)).length === 3);

    browser = await chromium.launch({ executablePath: EDGE, headless: true });
    const requests = [];
    async function open(viewport, id) {
      const ctx = await browser.newContext({ viewport, locale: "ko-KR" });
      const page = await ctx.newPage();
      page.on("request", (r) => requests.push({ url: r.url(), method: r.method() }));
      page.on("pageerror", (e) => console.log("  [pageerror]", e.message));
      await page.goto("http://127.0.0.1:4173/?net=localhost");
      await page.waitForSelector("#net");
      await page.click("#tab-tree");
      await page.fill("#tAgentId", String(id));
      await page.click("#treeBtn");
      await page.waitForSelector("#linAgent" + id);
      return { ctx, page };
    }
    const txt = (page, sel) => page.locator(sel).innerText();

    console.log("[ui] desktop, agent A (ko)");
    const { ctx, page } = await open({ width: 1280, height: 900 }, 1);
    check("tab: wallet card hidden on the lineage tab", !(await page.locator("#walletCard").isVisible()));
    check("A: v1, v2, v3 timeline in order", (await page.locator("#linAgent1 > .lin-chain > .lin-node").count()) === 3 && /^v1/.test(await txt(page, "#linNode1v1")) && /^v3/.test(await txt(page, "#linNode1v3")));
    const n1 = await txt(page, "#linNode1v1");
    check("A@v1: date, 10-hex hash, note and score count (2)", /UTC/.test(n1) && n1.includes(H.A1.slice(2, 12)) && !n1.includes(H.A1.slice(2, 13)) && /A first/.test(n1) && /점수 2개/.test(n1), n1);
    check("A@v2: score count 0; A@v3 (head): 1 and head badge", /점수 0개/.test(await txt(page, "#linNode1v2")) && /점수 1개/.test(await txt(page, "#linNode1v3")) && /가장 최근|최신|head/i.test(await txt(page, "#linNode1v3")));
    check("branches hang from v2 only (B and C), nothing on v1/v3", (await page.locator("#linBranch1v2 > .lin-agent").count()) === 2 && (await page.locator("#linBranch1v1, #linBranch1v3").count()) === 0);
    check("B branch shows its own chain and the fork origin 'A (#1) v2'", /Synthetic-B/.test(await txt(page, "#linAgent2")) && /Synthetic-A \(#1\).*v2/.test(await txt(page, "#linAgent2 > .lin-fork")), await txt(page, "#linAgent2 > .lin-fork"));
    check("C (metaURI-only mark) is a branch of A@v2 too", (await page.locator("#linBranch1v2 #linAgent3").count()) === 1);
    check("D (fork of B@v1) is nested under B, i.e. a branch of a branch", (await page.locator("#linBranch2v1 #linAgent4").count()) === 1 && (await page.locator("#linBranch1v2 #linAgent4").count()) === 1);
    check("E (claims non-existing A@v9) is not drawn as a branch; listed as a dangling mark", (await page.locator("#linAgent5 .lin-chain").count()) === 0 && /Synthetic-E/.test(await txt(page, "#linAgent1 > .lin-dangling")) && /v9/.test(await txt(page, "#linAgent1 > .lin-dangling")));
    check("F (unrelated) does not appear", (await page.locator("#linAgent6").count()) === 0);
    const badges = await page.locator("#treeOut .badge.selfrep").allInnerTexts();
    check("every fork mark carries the 'self-reported, not verified' badge (B, C, D, E)", badges.length === 4 && badges.every((b) => b === "자기 신고 표기, 검증되지 않음"), badges.join("|"));
    check("self-report warning shown above the form", /직접 적은 주장/.test(await txt(page, "#panel-tree > p.warn")));
    await page.screenshot({ path: path.join(SHOTS, "lineage-desktop-ko.png"), fullPage: true });

    console.log("[ui] English");
    await page.click('[data-lang="en"]');
    check("en: badge, score count and branch label translated", (await page.locator("#treeOut .badge.selfrep").first().innerText()) === "Self-reported mark, not verified" && /1 score\(s\)/.test(await txt(page, "#linNode1v3")) && /Branch/.test(await txt(page, "#linBranch1v2")) && /Forked from Synthetic-A \(#1\) at v2/.test(await txt(page, "#linAgent2 > .lin-fork")));
    await page.screenshot({ path: path.join(SHOTS, "lineage-desktop-en.png"), fullPage: true });
    await page.click('[data-lang="ko"]');

    console.log("[ui] looking up B (a fork) shows its own parent claim");
    await page.fill("#tAgentId", "2");
    await page.click("#treeBtn");
    await page.waitForFunction(() => /Synthetic-A/.test(document.querySelector("#linAgent2 .lin-fork")?.textContent || ""));
    check("B: root view has own chain, fork-origin line, and D branch (no A chain drawn)", (await page.locator("#linAgent1").count()) === 0 && (await page.locator("#linBranch2v1 #linAgent4").count()) === 1 && /Synthetic-A \(#1\)/.test(await txt(page, "#linAgent2 > .lin-fork")));
    await page.fill("#tAgentId", "99");
    await page.click("#treeBtn");
    await page.waitForFunction(() => /없습니다/.test(document.getElementById("treeMsg").textContent));
    check("missing agent: plain message, nothing drawn", (await page.locator("#treeOut *").count()) === 0);
    const origins = new Set(requests.map((r) => new URL(r.url).origin));
    check("network: only page origin + local RPC; static files are GET only", [...origins].every((o) => o === "http://127.0.0.1:4173" || o === RPC) && requests.filter((r) => r.url.startsWith("http://127.0.0.1:4173")).every((r) => r.method === "GET"), [...origins].join(","));
    await ctx.close();

    console.log("[ui] mobile 390x844");
    const m = await open({ width: 390, height: 844 }, 1);
    check("mobile: no horizontal overflow", (await m.page.evaluate(() => document.documentElement.scrollWidth)) <= 390);
    check("mobile: the nested branch is visible within the viewport", await m.page.evaluate(() => { const r = document.getElementById("linAgent4").getBoundingClientRect(); return r.left >= 0 && r.right <= window.innerWidth + 1 && r.width > 120; }));
    await m.page.screenshot({ path: path.join(SHOTS, "lineage-mobile-390-ko.png"), fullPage: true });
    await m.ctx.close();
  } finally {
    if (browser) await browser.close();
    server.close();
    node.kill();
  }
  console.log(`\nLineage E2E result: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
