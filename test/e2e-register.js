// End-to-end test of register/ against a LOCAL hardhat node (never touches a testnet/mainnet).
// Run: node test/e2e-register.js        (needs: npm i, npx hardhat compile, Microsoft Edge)
// The "wallet" is an EIP-1193 mock backed by hardhat's well-known default test accounts (public keys, worthless).
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const { spawn } = require("child_process");
const { ethers } = require("ethers");
const { chromium } = require("playwright-core");
const { buildTree, SOUL_ENTRY_TYPES, entryLeaf } = require("../lib/merkle");

const ROOT = path.join(__dirname, "..");
const REG_DIR = path.join(ROOT, "register");
const SHOTS = path.join(ROOT, "docs", "register");
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const RPC = "http://127.0.0.1:8545";
const KEYS = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", // hardhat #0 (deployer/anchorer)
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d", // hardhat #1
];
const config = fs.readFileSync(path.join(REG_DIR, "config.js"), "utf8");
const REGISTRY = config.match(/localhost:[\s\S]*?registry: "(0x[0-9a-fA-F]{40})"/)[1];

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail !== undefined ? "  -> " + detail : ""}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitRpc() {
  const p = new ethers.JsonRpcProvider(RPC);
  for (let i = 0; i < 480; i++) { try { await p.getBlockNumber(); return p; } catch { await sleep(500); } } // node start can take ~1 min on a busy PC
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

// EIP-1193 mock, state lives in node
function makeWallet(provider) {
  const st = { chainId: 84532, account: 0, switchedOnce: false, sendTx: 0, signs: 0, methods: [] };
  const wallets = KEYS.map((k) => new ethers.Wallet(k));
  async function rpc(method, params) {
    st.methods.push(method);
    try {
      switch (method) {
        case "eth_requestAccounts":
        case "eth_accounts": return { result: [wallets[st.account].address.toLowerCase()] };
        case "eth_chainId": return { result: ethers.toQuantity(st.chainId) };
        case "net_version": return { result: String(st.chainId) };
        case "wallet_switchEthereumChain":
          if (!st.switchedOnce) { st.switchedOnce = true; return { error: { code: 4902, message: "Unrecognized chain ID" } }; }
          st.chainId = Number(params[0].chainId); return { result: null };
        case "wallet_addEthereumChain":
          st.chainId = Number(params[0].chainId); st.added = params[0]; return { result: null };
        case "eth_signTypedData_v4": {
          st.signs++;
          const typed = JSON.parse(params[1]);
          if (Number(typed.domain.chainId) !== st.chainId) return { error: { code: -32000, message: "chainId mismatch" } };
          delete typed.types.EIP712Domain;
          return { result: await wallets[st.account].signTypedData(typed.domain, typed.types, typed.message) };
        }
        case "eth_sendTransaction": st.sendTx++; return { result: await provider.send("eth_sendTransaction", params) };
        default: return { result: await provider.send(method, params) };
      }
    } catch (e) {
      const data = e.info && e.info.error;
      return { error: { code: (data && data.code) || -32603, message: (data && data.message) || e.message, data: data && data.data } };
    }
  }
  return { st, wallets, rpc };
}

const MOCK_INIT = `
  (() => {
    const L = {};
    window.ethereum = {
      isMock: true,
      on(e, f) { (L[e] = L[e] || []).push(f); },
      removeListener() {},
      _emit(e, a) { (L[e] || []).forEach((f) => f(a)); },
      async request({ method, params }) {
        const r = await window.__rpc(method, params || []);
        if (r.error) { const err = new Error(r.error.message); err.code = r.error.code; err.data = r.error.data; throw err; }
        return r.result;
      },
    };
  })();`;

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ieum-e2e-"));

  // ── static checks of the page code ──
  console.log("[static] page code");
  const appSrc = fs.readFileSync(path.join(REG_DIR, "app.js"), "utf8");
  const forbidden = /\b(fetch|XMLHttpRequest|sendBeacon|WebSocket|EventSource|importScripts)\b/;
  check("app.js has no fetch/XHR/sendBeacon/WebSocket", !forbidden.test(appSrc.replace(/\/\*[\s\S]*?\*\//, "")));
  const htmlSrc = fs.readFileSync(path.join(REG_DIR, "index.html"), "utf8");
  const inputTags = htmlSrc.match(/<(input|textarea)\b[^>]*>/g) || [];
  check("no password-type input and no key/mnemonic-named input", inputTags.length > 0 && !inputTags.some((t) => /type="password"|private|mnemonic|seed|secret|비밀|개인키/i.test(t)), inputTags.length);
  check("CSP meta present with connect-src", /Content-Security-Policy[\s\S]*connect-src/.test(htmlSrc));
  check("config has no active mainnet (only commented)", !/^\s*base:\s*\{/m.test(config) && /allowMainnet: false/.test(config));

  // ── chain ──
  console.log("[setup] hardhat node + deploy");
  const node = spawn(process.execPath, [path.join(ROOT, "node_modules", "hardhat", "internal", "cli", "bootstrap.js"), "node"], { cwd: ROOT, stdio: "ignore" });
  const server = await serveStatic();
  let browser;
  try {
    const provider = await waitRpc();
    const art = JSON.parse(fs.readFileSync(path.join(ROOT, "artifacts", "contracts", "SoulRegistry.sol", "SoulRegistry.json"), "utf8"));
    const deployer = new ethers.NonceManager(new ethers.Wallet(KEYS[0], provider));
    const factory = new ethers.ContractFactory(art.abi, art.bytecode, deployer);
    const regD = await factory.deploy();
    await regD.waitForDeployment();
    check("local deploy address equals config.js localhost address", (await regD.getAddress()) === REGISTRY, await regD.getAddress());
    const reg = new ethers.Contract(REGISTRY, art.abi, provider);

    const w = makeWallet(provider);
    // network log
    const requests = [];
    browser = await chromium.launch({ executablePath: EDGE, headless: true });
    async function newPage(viewport) {
      const ctx = await browser.newContext({ viewport, acceptDownloads: true, locale: "ko-KR" });
      await ctx.exposeFunction("__rpc", (m, p) => w.rpc(m, p));
      await ctx.addInitScript(MOCK_INIT);
      const page = await ctx.newPage();
      page.on("request", (r) => requests.push({ url: r.url(), method: r.method(), body: r.postData() || "" }));
      page.on("pageerror", (e) => console.log("  [pageerror]", e.message));
      return { ctx, page };
    }

    // files
    const v1 = path.join(REG_DIR, "sample", "SOUL_sample_v1.md");
    const v1bytes = fs.readFileSync(v1);
    const v1hash = "0x" + crypto.createHash("sha256").update(v1bytes).digest("hex");
    const v2 = path.join(tmp, "SOUL_sample_v2.md");
    fs.writeFileSync(v2, Buffer.concat([v1bytes, Buffer.from("\n## Update\nI now also remind the user to rest.\n")]));
    const v2hash = "0x" + crypto.createHash("sha256").update(fs.readFileSync(v2)).digest("hex");
    const other = path.join(tmp, "unrelated.md");
    fs.writeFileSync(other, "something else entirely\r\nwith CRLF\r\n");
    const ieumV1 = "D:\\openclaw-outputs\\soul-chain-ieum\\history\\SOUL_v1.md"; // real file, used only for hashing check
    const MARKER = "ZEBRA-MARKER-4f9c1e";

    // ═════ desktop run ═════
    console.log("[ui] desktop 1280x900");
    const { ctx, page } = await newPage({ width: 1280, height: 900 });
    // SYNTHETIC score evidence for the e2e (not real results): evidence.js is served with one valid and one forged mapping.
    const EVID_URL = "https://example.org/synthetic-score-demo";
    const EVID_HASH = "0x" + crypto.createHash("sha256").update(EVID_URL).digest("hex");
    const FORGED_HASH = "0x" + crypto.createHash("sha256").update("some other report").digest("hex");
    await ctx.route("**/evidence.js", (route) => route.fulfill({ contentType: "text/javascript", body: `window.IEUM_EVIDENCE = ${JSON.stringify({ [EVID_HASH]: EVID_URL, [FORGED_HASH]: "https://example.org/forged-link" })};` }));
    await page.goto("http://127.0.0.1:4173/?net=localhost");
    await page.waitForSelector("#net");
    const noticeText = await page.locator(".notice").innerText();
    check("first screen states SOUL is never uploaded (ko)", /SOUL 내용은 절대 올라가지 않습니다/.test(noticeText) && /지문\(해시\)만 계산/.test(noticeText) && /영구 공개/.test(noticeText), noticeText.slice(0, 80));
    check("notice visible above the file picker", (await page.locator(".notice").boundingBox()).y < (await page.locator("#step1").boundingBox()).y);
    await page.screenshot({ path: path.join(SHOTS, "desktop-01-first-screen-ko.png"), fullPage: false });
    await page.click('[data-lang="en"]');
    check("language toggle -> English", /never uploaded/.test(await page.locator(".notice").innerText()) && (await page.locator("h1").innerText()).includes("Register"));
    await page.screenshot({ path: path.join(SHOTS, "desktop-02-first-screen-en.png"), fullPage: false });
    check("footer en text", (await page.textContent("#footMaker")) === "Made by Wunjong Shin · Ieum" && (await page.textContent("#footContact")) === "Contact: dkakrptehsrk@gmail.com" && (await page.textContent("#footFree")) === "This ledger is free.");
    await page.click('[data-lang="ko"]');
    check("language toggle back -> Korean", /절대 올라가지/.test(await page.locator(".notice").innerText()));
    check("footer ko: maker / contact mailto / free line; support link shown (donation on)", (await page.textContent("#footMaker")) === "만든 사람: 신운종 · 이음(Ieum)" && (await page.textContent("#footContact")) === "문의: dkakrptehsrk@gmail.com" && (await page.getAttribute("#footContact a", "href")) === "mailto:dkakrptehsrk@gmail.com" && (await page.textContent("#footFree")) === "이 장부는 무료입니다." && await page.locator("#footDonation").isVisible() && (await page.locator('a[href="donate.html"]').count()) === 1);
    check("network select shows localhost", (await page.inputValue("#net")) === "localhost");
    const unlabeled = await page.evaluate(() => [...document.querySelectorAll("input,select,textarea")].filter((e) => !e.labels?.length && !e.getAttribute("aria-label") && e.type !== "radio" && e.type !== "checkbox" || (e.type === "checkbox" && !e.closest("label"))).map((e) => e.id));
    check("every form control has an accessible label", unlabeled.length === 0, unlabeled.join(","));

    // hash rule
    await page.setInputFiles("#soulFile", v1);
    await page.waitForSelector("#soulHashOut");
    check("file hash == SHA-256 of raw bytes (node crypto)", (await page.textContent("#soulHashOut")) === v1hash);
    const pasteOk = await (async () => {
      await page.click("details.paste summary");
      await page.fill("#soulText", v1bytes.toString("utf8"));
      return (await page.textContent("#soulHashOut")) === v1hash;
    })();
    check("pasted text (LF) gives the same hash as the file", pasteOk);
    if (fs.existsSync(ieumV1)) {
      await page.setInputFiles("#soulFile", ieumV1);
      await page.waitForFunction(() => document.getElementById("soulHashOut")?.textContent.startsWith("0xcd1823"));
      check("Ieum SOUL_v1 hash == README/on-chain value cd182363…", (await page.textContent("#soulHashOut")) === "0xcd1823639d2be7f90933b329779195eb402ba24fdd8a6de15b75b74791948dfe");
    }
    await page.setInputFiles("#soulFile", v1);
    await page.waitForFunction((h) => document.getElementById("soulHashOut")?.textContent === h, v1hash);

    // wallet + wrong chain
    await page.click("#connect");
    await page.waitForSelector("#wAccount");
    check("wallet connected, account shown", (await page.textContent("#wAccount")) === w.wallets[0].address);
    check("wrong-network warning shown (wallet on 84532)", await page.locator("#chainWarn").isVisible());
    await page.click("#switchChain");
    await page.waitForFunction(() => document.getElementById("chainWarn").hidden, null, { timeout: 8000 }).catch(async (e) => { console.log("DEBUG walletMsg:", await page.textContent("#walletMsg"), "chain", w.st.chainId, w.st.methods.slice(-6)); throw e; });
    check("network switch (addEthereumChain fallback) works", w.st.chainId === 31337 && !!w.st.added);

    // A: new
    await page.fill("#dName", "하람 (시험)");
    await page.fill("#dAgentNote", "시험용 가상 도우미");
    await page.fill("#dVersionNote", "첫 버전");
    check("byte counter shown", /\d+ \/ 64/.test(await page.textContent("#dNameC")));
    await page.screenshot({ path: path.join(SHOTS, "desktop-03-direct-form.png"), fullPage: true });
    await page.click("#sendDirect");
    check("send without checkbox is refused", /체크/.test(await page.textContent("#directMsg")));
    await page.click("#estimate");
    await page.waitForFunction(() => /예상 가스|비용을 계산/.test(document.getElementById("estimateOut").textContent));
    const est = await page.textContent("#estimateOut");
    check("gas estimate shown", /예상 가스 \d+/.test(est) && /ETH/.test(est), est);
    await page.check("#dAck");
    await page.click("#sendDirect");
    await page.waitForSelector("#resultAgentId", { timeout: 20000 });
    check("A register: result shows #1", (await page.textContent("#resultAgentId")) === "#1");
    const a1 = await reg.getAgent(1n);
    const h1 = await reg.getHistory(1n);
    check("A on-chain agent name/owner correct", a1.name === "하람 (시험)" && a1.owner === w.wallets[0].address);
    check("A on-chain first record = file hash, parent 0", h1.length === 1 && h1[0].soulHash === v1hash && h1[0].parentHash === ethers.ZeroHash && h1[0].note === "첫 버전");
    check("A used 2 wallet transactions", w.st.sendTx === 2, w.st.sendTx);
    await page.screenshot({ path: path.join(SHOTS, "desktop-04-direct-result.png"), fullPage: true });

    // A: append
    await page.check('input[name=mode][value=append]');
    await page.setInputFiles("#soulFile", v2);
    await page.waitForFunction((h) => document.getElementById("soulHashOut")?.textContent === h, v2hash);
    await page.fill("#dAgentId", "1");
    await page.click("#loadAgent");
    await page.waitForSelector("#headOut");
    check("append: head auto-loaded from chain", (await page.textContent("#headOut")) === v1hash);
    await page.fill("#dVersionNote", "휴식 알림 추가");
    await page.check("#dAck");
    await page.click("#estimate");
    await page.waitForFunction(() => /예상 가스/.test(document.getElementById("estimateOut").textContent));
    check("append: gas estimate shown", true);
    const before = w.st.sendTx;
    await page.click("#sendDirect");
    await page.waitForFunction(() => /새 버전이 기록/.test(document.getElementById("directMsg").textContent), null, { timeout: 20000 });
    const h2 = await reg.getHistory(1n);
    check("append: 2 records, parent = previous hash", h2.length === 2 && h2[1].soulHash === v2hash && h2[1].parentHash === v1hash);
    check("append: verifyChain true", await reg.verifyChain(1n));
    check("append: one wallet transaction", w.st.sendTx === before + 1);
    // append same hash again -> blocked in UI
    await page.click("#loadAgent");
    await page.waitForSelector("#agentBox p.err");
    check("append: same-as-head is flagged", /이미 .*가장 최근/.test(await page.textContent("#agentBox")));
    const sentBefore = w.st.sendTx;
    await page.click("#sendDirect");
    await page.waitForFunction(() => /가장 최근/.test(document.getElementById("directMsg").textContent));
    check("append: duplicate attempt sends no transaction", w.st.sendTx === sentBefore);
    // not-owner
    w.st.account = 1;
    await page.evaluate((a) => window.ethereum._emit("accountsChanged", [a]), w.wallets[1].address.toLowerCase());
    await page.waitForFunction((a) => document.getElementById("wAccount").textContent === a, w.wallets[1].address);
    await page.click("#loadAgent");
    await page.waitForSelector("#agentBox p.err");
    check("non-owner account is warned", /주인이 아닙니다/.test(await page.textContent("#agentBox")));
    w.st.account = 0;
    await page.evaluate((a) => window.ethereum._emit("accountsChanged", [a]), w.wallets[0].address.toLowerCase());
    await page.waitForFunction((a) => document.getElementById("wAccount").textContent === a, w.wallets[0].address);
    // too long name blocked
    await page.check('input[name=mode][value=new]');
    await page.fill("#dName", "가".repeat(30));
    await page.click("#sendDirect");
    check("over-length name (30 Korean chars = 90 bytes) blocked", /너무 깁니다/.test(await page.textContent("#directMsg")));
    await page.fill("#dName", "x");

    // ④ SYNTHETIC scores for v1 only (written with scripts/record-score.js against the LOCAL node; values are made up for the test)
    const { run: recordScore } = require("../scripts/record-score");
    const ownerReg = new ethers.Contract(REGISTRY, art.abi, new ethers.NonceManager(new ethers.Wallet(KEYS[0], provider)));
    const rsLog = [];
    const rs = (args) => recordScore(args, { registry: ownerReg, env: { DRY: "0" }, log: (s) => rsLog.push(s) });
    check("④ record-score DRY (default) sends nothing", (await recordScore(["--agent", "1", "--soul-hash", v1hash, "--model", "synthetic-B", "--score", "0.5", "--evidence-url", EVID_URL], { registry: ownerReg, env: {}, log: () => {} })) === 0 && (await reg.getScores(1n)).length === 0);
    check("④ record-score sends score 1 (SYNTHETIC 0.8123, evidence URL hash)", (await rs(["--agent", "1", "--soul-hash", v1hash, "--from-model", "synthetic-A", "--model", "synthetic-B", "--score", "0.8123", "--evidence-url", EVID_URL])) === 0, rsLog.join("|"));
    check("④ record-score sends score 2 (SYNTHETIC 0.5, hash only, no known URL)", (await rs(["--agent", "1", "--soul-hash", v1hash, "--from-model", "synthetic-B", "--model", "synthetic-C", "--score", "0.5", "--report-hash", "0x" + "ab".repeat(32)])) === 0, rsLog.join("|"));
    check("④ record-score sends score 3 (SYNTHETIC 0.3, forged-link hash)", (await rs(["--agent", "1", "--soul-hash", v1hash, "--model", "synthetic-D", "--score", "0.3", "--report-hash", FORGED_HASH])) === 0, rsLog.join("|"));
    check("④ scores are on-chain", (await reg.getScores(1n)).length === 3);

    // C: lookup + match
    await page.click("#tab-lookup");
    check("wallet card hidden on lookup tab", !(await page.locator("#walletCard").isVisible()));
    await page.fill("#lAgentId", "1");
    await page.click("#lookupBtn");
    await page.waitForSelector("#chainValid");
    check("lookup: chain check passed", (await page.textContent("#chainValid")) === "통과");
    check("lookup: shows both versions", (await page.locator(".rec").count()) === 2);
    check("lookup: chosen file (v2) matches v2 (latest)", /v2/.test(await page.textContent("#matchResult")) && /가장 최근/.test(await page.textContent("#matchResult")));
    await page.screenshot({ path: path.join(SHOTS, "desktop-05-lookup-match.png"), fullPage: true });
    // ④ score tables per version
    check("④ v1 shows a score table with 3 rows, v2 shows 'No score yet' (ko)", (await page.locator("#scores1 tbody tr").count()) === 3 && (await page.textContent("#noScore2")) === "아직 점수 없음" && (await page.locator("#scores2").count()) === 0);
    const rowsTxt = await page.locator("#scores1 tbody tr").allInnerTexts();
    check("④ rows: models, score %, date", /synthetic-A → synthetic-B\s+81\.23%/.test(rowsTxt[0]) && /50\.00%/.test(rowsTxt[1]) && /\(미기재\) → synthetic-D\s+30\.00%/.test(rowsTxt[2]) && /UTC/.test(rowsTxt[0]), rowsTxt.join(" / "));
    const hrefs4 = await page.$$eval("#scores1 a", (as) => as.map((a) => a.href + "|" + a.rel));
    check("④ evidence link only where sha256(url)==reportHash (forged mapping not linked, https only)", hrefs4.length === 1 && hrefs4[0] === EVID_URL + "|noopener noreferrer" && (await page.locator("#scores1 code").count()) === 2, hrefs4.join(","));
    check("④ self-report disclaimer shown", /소유자가 직접 남긴 기록/.test(await page.textContent("#scoreNote")));
    await page.screenshot({ path: path.join(SHOTS, "desktop-09-scores-ko.png"), fullPage: true });
    await page.click('[data-lang="en"]');
    check("④ English: table headers + 'No score yet' + disclaimer", /Model switch/.test(await page.textContent("#scores1 thead")) && (await page.textContent("#noScore2")) === "No score yet" && /owner's own records/.test(await page.textContent("#scoreNote")) && (await page.textContent("#scores1 a")) === "View evidence");
    await page.screenshot({ path: path.join(SHOTS, "desktop-10-scores-en.png"), fullPage: true });
    await page.click('[data-lang="ko"]');
    await page.setInputFiles("#soulFile", v1);
    await page.waitForFunction(() => /v1/.test(document.getElementById("matchResult")?.textContent || ""));
    check("lookup: switching to v1 file matches v1", /v1/.test(await page.textContent("#matchResult")));
    await page.setInputFiles("#soulFile", other);
    await page.waitForFunction(() => /같지 않습니다/.test(document.getElementById("matchResult")?.textContent || ""));
    check("lookup: unrelated file -> no match", /같지 않습니다/.test(await page.textContent("#matchResult")));
    await page.screenshot({ path: path.join(SHOTS, "desktop-06-lookup-nomatch.png"), fullPage: true });
    // missing agent
    await page.fill("#lAgentId", "99");
    await page.click("#lookupBtn");
    await page.waitForFunction(() => /조회 실패/.test(document.getElementById("lookupMsg").textContent));
    check("lookup of unknown agent shows friendly failure", true);

    // B: free batched
    await page.click("#tab-free");
    check("wallet card visible on free tab", await page.locator("#walletCard").isVisible());
    const v3 = path.join(tmp, "SOUL_free_v1.md");
    fs.writeFileSync(v3, "free batch sample soul\n");
    const v3hash = "0x" + crypto.createHash("sha256").update(fs.readFileSync(v3)).digest("hex");
    await page.setInputFiles("#soulFile", v3);
    await page.waitForFunction((h) => document.getElementById("soulHashOut")?.textContent === h, v3hash);
    await page.fill("#fName", "자유 시험");
    await page.fill("#fNote", "서명만 한 항목");
    await page.check("#fAck");
    const txBefore = w.st.sendTx;
    await page.click("#signBtn");
    await page.waitForSelector("#downloadLink", { timeout: 15000 });
    check("B: signing sent no transaction (fee 0)", w.st.sendTx === txBefore && w.st.signs === 1);
    check("B: signer self-check + contract digest match reported", /통과/.test(await page.locator("#freeResult").innerText()) && /일치/.test(await page.locator("#freeResult").innerText()));
    await page.screenshot({ path: path.join(SHOTS, "desktop-07-free-signed.png"), fullPage: true });
    const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#downloadLink")]);
    const dlPath = path.join(tmp, "entry.json");
    await dl.saveAs(dlPath);
    const file = JSON.parse(fs.readFileSync(dlPath, "utf8"));
    check("B: downloaded file has expected fields", file.format === "ieum-ledger-entry" && file.chainId === 31337 && file.registry === REGISTRY && file.entry.soulHash === v3hash && file.entry.owner === w.wallets[0].address);
    // contract-side proof
    const entry = { ...file.entry, signedAt: BigInt(file.entry.signedAt) };
    const domain = { name: "SoulRegistry", version: "1", chainId: 31337n, verifyingContract: REGISTRY };
    check("B: leaf in file == lib/merkle.js entryLeaf", entryLeaf(domain, entry, file.signature) === file.leaf);
    check("B: digest in file == contract.entryDigest", (await reg.entryDigest(entry)) === file.digest);
    const other2 = ethers.Wallet.createRandom();
    const sig2 = await other2.signTypedData(domain, SOUL_ENTRY_TYPES, { ...entry, owner: other2.address, agentName: "Other" });
    const e2 = { ...entry, owner: other2.address, agentName: "Other" };
    const leaves = [file.leaf, entryLeaf(domain, e2, sig2)];
    const { root, proofs } = buildTree(leaves);
    const regAnchor = new ethers.Contract(REGISTRY, art.abi, new ethers.Wallet(KEYS[0], provider));
    await (await regAnchor.anchorBatch(root, 2)).wait();
    check("B: contract.verifyBatchEntry accepts the page-made signature", await reg.verifyBatchEntry(entry, file.signature, proofs[0], root));
    check("B: contract rejects a tampered note", !(await reg.verifyBatchEntry({ ...entry, note: "tampered" }, file.signature, proofs[0], root)));
    // verify in the page
    await page.click("#tab-lookup");
    const receipt = path.join(tmp, "receipt.json");
    fs.writeFileSync(receipt, JSON.stringify({ ...file, proof: proofs[0], root }));
    await page.setInputFiles("#entryFile", receipt);
    await page.waitForSelector("#verifyBatchOut");
    check("UI verify: signature ok", (await page.textContent("#verifySigOut")).includes("직접 서명"));
    check("UI verify: batch inclusion confirmed by contract", /묶음\(root\)에 포함/.test(await page.textContent("#verifyBatchOut")));
    check("UI verify: SOUL file hash equals signed hash", /같습니다/.test(await page.textContent("#verifySoulOut")));
    await page.screenshot({ path: path.join(SHOTS, "desktop-08-verify-signed.png"), fullPage: true });
    const bad = path.join(tmp, "bad.json");
    fs.writeFileSync(bad, JSON.stringify({ ...file, entry: { ...file.entry, note: "tampered" }, proof: proofs[0], root }));
    await page.setInputFiles("#entryFile", bad);
    await page.waitForFunction(() => /NOT|아닙니다/.test(document.getElementById("verifySigOut")?.textContent || ""));
    check("UI verify: tampered file -> signature rejected", true);
    const noproof = path.join(tmp, "noproof.json");
    fs.writeFileSync(noproof, JSON.stringify(file));
    await page.setInputFiles("#entryFile", noproof);
    await page.waitForSelector("#verifyNoProofOut");
    check("UI verify: file without proof -> signature only", true);

    // privacy: network log
    const origins = new Set(requests.map((r) => new URL(r.url).origin));
    const b64 = v1bytes.toString("base64").slice(0, 40);
    const leaks = requests.filter((r) => [MARKER, Buffer.from(MARKER).toString("hex"), Buffer.from(MARKER).toString("base64").slice(0, 16), b64].some((s) => (r.url + r.body).includes(s)));
    check("network: no request contains SOUL content (plain/hex/base64)", leaks.length === 0, leaks.length);
    check("network: only page origin + local RPC contacted", [...origins].every((o) => o === "http://127.0.0.1:4173" || o === RPC), [...origins].join(","));
    check("network: non-RPC requests are all GET of static files", requests.filter((r) => r.url.startsWith("http://127.0.0.1:4173")).every((r) => r.method === "GET"));
    const rpcBodies = requests.filter((r) => r.url === RPC).map((r) => r.body).join("\n");
    check("network: direct RPC traffic (if any) never carries the content", !rpcBodies.includes(MARKER));
    await ctx.close();

    // ═════ mobile run ═════
    console.log("[ui] mobile 390x844");
    w.st.chainId = 84532; // wallet starts on another net again
    const m = await newPage({ width: 390, height: 844 });
    await m.page.goto("http://127.0.0.1:4173/?net=localhost");
    await m.page.waitForSelector("#net");
    await m.page.screenshot({ path: path.join(SHOTS, "mobile-01-first-screen-ko.png"), fullPage: false });
    await m.page.setInputFiles("#soulFile", v2);
    await m.page.waitForSelector("#soulHashOut");
    await m.page.screenshot({ path: path.join(SHOTS, "mobile-02-soul-loaded.png"), fullPage: true });
    await m.page.click("#connect");
    await m.page.waitForSelector("#wAccount");
    await m.page.screenshot({ path: path.join(SHOTS, "mobile-03-wallet-wrongchain.png"), fullPage: true });
    await m.page.fill("#dName", "하람 (시험)");
    await m.page.click("#tab-lookup");
    await m.page.fill("#lAgentId", "1");
    await m.page.click("#lookupBtn");
    await m.page.waitForSelector("#chainValid");
    await m.page.screenshot({ path: path.join(SHOTS, "mobile-04-lookup.png"), fullPage: true });
    await m.page.click('[data-lang="en"]');
    await m.page.click("#tab-free");
    await m.page.screenshot({ path: path.join(SHOTS, "mobile-05-free-en.png"), fullPage: true });
    for (const tab of ["direct", "free", "lookup"]) {
      await m.page.click("#tab-" + tab);
      const sw = await m.page.evaluate(() => document.documentElement.scrollWidth);
      if (sw > 390) console.log("DEBUG wide:", JSON.stringify(await m.page.evaluate(() => [...document.querySelectorAll("body *")].filter((e) => e.getBoundingClientRect().right > 392 && e.offsetParent).slice(0, 8).map((e) => e.tagName + "#" + e.id + "." + e.className + " " + Math.round(e.getBoundingClientRect().right)))));
      check(`mobile: no horizontal overflow on '${tab}' tab (scrollWidth ${sw} <= 390)`, sw <= 390);
    }
    await m.ctx.close();

    // ═════ donation page ═════
    console.log("[donate] footer link + donate.html");
    const dsrc = fs.readFileSync(path.join(REG_DIR, "donate.js"), "utf8") + fs.readFileSync(path.join(REG_DIR, "donate-check.js"), "utf8");
    const dsrcNoFetch = dsrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/fetch\("donors\.json", \{ cache: "no-store", credentials: "omit" \}\)/g, "");
    check("donate.js/donate-check.js: only network use is fetch of the static donors.json (no XHR/sendBeacon/WebSocket/other fetch)", !forbidden.test(dsrcNoFetch) && (dsrc.match(/\bfetch\(/g) || []).length === 1);
    check("donor-name.js / add-donor-name.js verifier have no network code", !forbidden.test(fs.readFileSync(path.join(REG_DIR, "donor-name.js"), "utf8")) && !/\bfetch\b|https?:\/\//.test(fs.readFileSync(path.join(ROOT, "scripts", "add-donor-name.js"), "utf8")));
    const donHtml = fs.readFileSync(path.join(REG_DIR, "donate.html"), "utf8");
    const donCsp = (donHtml.match(/Content-Security-Policy" content="([^"]*)"/) || [])[1] || "";
    check("donate.html CSP: connect-src is exactly 'self' (no external origins anywhere in the CSP)", /connect-src 'self';/.test(donCsp) && !/https?:|\*/.test(donCsp), donCsp);
    check("committed register/donors.json is valid (only tx/from/amount-type fields)", (() => { const j = JSON.parse(fs.readFileSync(path.join(REG_DIR, "donors.json"), "utf8")); return j.chainId === 8453 && Array.isArray(j.donations) && j.donations.every((d) => Object.keys(d).every((k) => ["txHash", "logIndex", "time", "token", "amount", "raw", "decimals", "from", "name"].includes(k))); })());
    check("real config.js donation: enabled with the owner address on Base", /donation:\s*\{\s*enabled: true,/.test(config) && config.includes("0x82F385D7698fAD15Ff14Ed6BB22F4a3B21C5CF43"));

    const TEST_ADDR = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"; // hardhat default account #1 (public, worthless)
    const ON = { enabled: true, page: "donate.html", address: TEST_ADDR, addressType: "evm", network: { ko: "Base 메인넷 (체인 ID 8453)", en: "Base mainnet (chain ID 8453)" }, assets: ["USDC", "ETH"], note: { ko: "", en: "" } };
    async function donPage(viewport, donation, opts = {}) {
      const dctx = await browser.newContext({ viewport, locale: "ko-KR", permissions: ["clipboard-read", "clipboard-write"], acceptDownloads: true });
      if (opts.donors !== undefined) await dctx.route("**/donors.json", (route) => opts.donors === null ? route.fulfill({ status: 404, body: "no" }) : route.fulfill({ contentType: "application/json", body: JSON.stringify(opts.donors) }));
      if (opts.wallet !== undefined) {
        const ws = KEYS.map((k) => new ethers.Wallet(k));
        await dctx.exposeFunction("__rpc", async (m, p) => {
          if (m === "eth_requestAccounts") return { result: [ws[opts.wallet].address.toLowerCase()] };
          if (m === "personal_sign") return { result: await ws[opts.wallet].signMessage(ethers.toUtf8String(p[0])) };
          return { error: { code: -32601, message: "unsupported " + m } };
        });
        await dctx.addInitScript(MOCK_INIT);
      }
      if (donation) await dctx.route("**/config.js", (route) => route.fulfill({ contentType: "text/javascript", body: config + `\nwindow.IEUM_CONFIG.footer.donation = ${JSON.stringify(donation)};\n` }));
      const dpage = await dctx.newPage();
      const reqs = [];
      dpage.on("request", (r) => reqs.push(r.url()));
      dpage.on("pageerror", (e) => console.log("  [pageerror]", e.message));
      return { dctx, dpage, reqs };
    }

    // (a) default (off): no link on the register page, "coming soon" on the page, no address / QR / warning
    const off = await donPage({ width: 1280, height: 900 }, { ...ON, enabled: false });
    await off.dpage.goto("http://127.0.0.1:4173/?net=localhost");
    await off.dpage.waitForSelector("#net");
    check("OFF: footer shows no support link", await off.dpage.locator("#footDonation").isHidden() && (await off.dpage.locator('a[href="donate.html"]').count()) === 0);
    await off.dpage.goto("http://127.0.0.1:4173/donate.html");
    await off.dpage.waitForSelector("#donOff");
    check("OFF: donate.html says coming soon", await off.dpage.locator("#donOff").isVisible() && /준비 중/.test(await off.dpage.locator("#donOff").innerText()));
    check("OFF: donate.html shows no address / QR / warning / copy button", await off.dpage.locator("#donOn").isHidden() && !(await off.dpage.content()).includes(TEST_ADDR) && (await off.dpage.locator("#qrBox svg").count()) === 0 && await off.dpage.locator("#copyBtn").isHidden());
    await off.dpage.screenshot({ path: path.join(SHOTS, "donate-off-desktop-ko.png") });
    await off.dctx.close();

    // enabled but invalid -> still hidden (bad address, bad type, missing network/assets, non-https-style page)
    const bads = [
      ["EVM address too short", { ...ON, address: TEST_ADDR.slice(0, 40) }],
      ["EVM address with non-hex", { ...ON, address: "0x" + "z".repeat(40) }],
      ["empty address", { ...ON, address: "" }],
      ["unknown addressType", { ...ON, addressType: "foo" }],
      ["no network text", { ...ON, network: { ko: "", en: "Base" } }],
      ["no assets", { ...ON, assets: [] }],
      ["page with a path/scheme", { ...ON, page: "https://evil.example/x.html" }],
      ["enabled=\"true\" string", { ...ON, enabled: "true" }],
      ["other-type address with spaces", { ...ON, addressType: "other", address: "bc1 not an address at all really" }],
    ];
    for (const [name, cfgBad] of bads) {
      const b = await donPage({ width: 1280, height: 900 }, cfgBad);
      await b.dpage.goto("http://127.0.0.1:4173/?net=localhost");
      await b.dpage.waitForSelector("#net");
      const linkHidden = await b.dpage.locator("#footDonation").isHidden();
      await b.dpage.goto("http://127.0.0.1:4173/donate.html");
      await b.dpage.waitForSelector("#donOff");
      const hidden = await b.dpage.locator("#donOn").isHidden() && (await b.dpage.locator("#qrBox svg").count()) === 0;
      check(`INVALID (${name}): no link, page stays "coming soon"`, linkHidden && hidden);
      await b.dctx.close();
    }
    // a valid non-EVM address passes the simple check
    const okOther = await donPage({ width: 1280, height: 900 }, { ...ON, addressType: "other", address: "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE", network: { ko: "트론", en: "TRON" }, assets: ["USDT"] });
    await okOther.dpage.goto("http://127.0.0.1:4173/donate.html");
    await okOther.dpage.waitForSelector("#donAddress");
    check("other-type address (TRON-style) is accepted by the simple check", await okOther.dpage.locator("#donOn").isVisible() && (await okOther.dpage.textContent("#donAddress")) === "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE");
    await okOther.dctx.close();

    // (b) ON with the public test address
    const on = await donPage({ width: 1280, height: 900 }, ON);
    await on.dpage.goto("http://127.0.0.1:4173/?net=localhost");
    await on.dpage.waitForSelector("#net");
    check("ON: footer shows the support link to donate.html", await on.dpage.locator("#footDonation a").isVisible() && (await on.dpage.getAttribute("#footDonation a", "href")) === "donate.html" && (await on.dpage.textContent("#footDonation a")) === "후원하기");
    await on.dpage.click('[data-lang="en"]');
    check("ON: footer link label in English = Support", (await on.dpage.textContent("#footDonation a")) === "Support");
    await on.dpage.click('[data-lang="ko"]');
    await on.dpage.click("#footDonation a");
    await on.dpage.waitForSelector("#donAddress");
    check("ON: address shown exactly", (await on.dpage.textContent("#donAddress")) === TEST_ADDR);
    const warnKo = await on.dpage.locator(".warn").innerText();
    check("ON: network warning names the network, tokens and the loss risk (ko)", /Base 메인넷/.test(warnKo) && /USDC \/ ETH/.test(warnKo) && /되찾을 수 없습니다/.test(warnKo) && /출금 네트워크/.test(warnKo), warnKo.slice(0, 60));
    const pageKo = await on.dpage.locator("main").innerText();
    check("ON: states free / optional-no-benefit / public-chain / irreversible (ko)", /무료/.test(pageKo) && /대가·권한·우선 등록/.test(pageKo) && /블록체인 거래는 공개/.test(pageKo) && /되돌릴 수 없습니다/.test(pageKo));
    check("ON: warning appears above the address", (await on.dpage.locator(".warn").boundingBox()).y < (await on.dpage.locator("#donAddress").boundingBox()).y);
    const qrInfo = await on.dpage.evaluate(() => { const s = document.querySelector("#qrBox svg"); const d = s && s.querySelector("path").getAttribute("d"); return { ok: !!s, len: d ? d.length : 0, w: s ? s.getBoundingClientRect().width : 0, label: s && s.getAttribute("aria-label") }; });
    check("ON: QR rendered locally as SVG (non-trivial, labelled)", qrInfo.ok && qrInfo.len > 500 && qrInfo.w > 100 && !!qrInfo.label, JSON.stringify(qrInfo));
    // QR content: decode with the browser's BarcodeDetector when available
    const svgMarkup = await on.dpage.evaluate(() => document.querySelector("#qrBox svg").outerHTML);
    const dec = await browser.newPage();
    const decoded = await dec.evaluate(async (svg) => {
      if (!("BarcodeDetector" in window)) return { unsupported: true };
      const img = new Image(); img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"'));
      await img.decode();
      const cv = document.createElement("canvas"); cv.width = 400; cv.height = 400; cv.getContext("2d").drawImage(img, 0, 0, 400, 400);
      const r = await new BarcodeDetector({ formats: ["qr_code"] }).detect(cv);
      return { text: r[0] && r[0].rawValue };
    }, svgMarkup).catch((e) => ({ err: String(e) }));
    if (decoded.unsupported || decoded.err) console.log("  (note) QR decode skipped:", decoded.unsupported ? "BarcodeDetector unavailable" : decoded.err);
    else check("ON: QR decodes to exactly the address", decoded.text === TEST_ADDR, decoded.text);
    await dec.close();
    // copy
    await on.dpage.click("#copyBtn");
    await on.dpage.waitForFunction(() => /복사했습니다/.test(document.getElementById("copyMsg").textContent));
    check("ON: copy button puts the exact address on the clipboard", (await on.dpage.evaluate(() => navigator.clipboard.readText())) === TEST_ADDR);
    await on.dpage.screenshot({ path: path.join(SHOTS, "donate-desktop-ko.png"), fullPage: true });
    await on.dpage.click('[data-lang="en"]');
    const warnEn = await on.dpage.locator(".warn").innerText();
    check("ON: English warning names network + tokens + loss risk", /Base mainnet/.test(warnEn) && /USDC \/ ETH/.test(warnEn) && /lose the funds/.test(warnEn) && /withdrawal network/.test(warnEn), warnEn.slice(0, 60));
    check("ON: English page states optional / public / irreversible", /Support is optional/.test(await on.dpage.locator("main").innerText()) && /public/.test(await on.dpage.locator("main").innerText()) && /cannot be undone/.test(await on.dpage.locator("main").innerText()));
    check("ON: language persists to the register page footer link (Support)", (await on.dpage.evaluate(() => localStorage.getItem("ieum-lang"))) === "en");
    await on.dpage.screenshot({ path: path.join(SHOTS, "donate-desktop-en.png"), fullPage: true });
    const ownOrigins = new Set(on.reqs.map((u) => new URL(u).origin));
    check("ON: no external network request (only the local static server)", [...ownOrigins].every((o) => o === "http://127.0.0.1:4173"), [...ownOrigins].join(","));
    await on.dctx.close();
    // mobile 390
    const onm = await donPage({ width: 390, height: 844 }, ON);
    await onm.dpage.goto("http://127.0.0.1:4173/donate.html");
    await onm.dpage.waitForSelector("#donAddress");
    check("mobile: donate page has no horizontal overflow", (await onm.dpage.evaluate(() => document.documentElement.scrollWidth)) <= 390);
    await onm.dpage.screenshot({ path: path.join(SHOTS, "donate-mobile-390-ko.png"), fullPage: true });
    await onm.dpage.click('[data-lang="en"]');
    await onm.dpage.screenshot({ path: path.join(SHOTS, "donate-mobile-390-en.png"), fullPage: true });
    await onm.dctx.close();

    // ═════ donor list + opt-in names ═════
    console.log("[donors] list, totals, anonymity, opt-in signed names");
    const { verify } = require("../scripts/add-donor-name.js");
    const DNm = require("../register/donor-name.js");
    const ADDR0 = new ethers.Wallet(KEYS[0]).address, ADDR1 = new ethers.Wallet(KEYS[1]).address; // hardhat #0/#1 (public test keys)
    const TXA = "0x" + "a1".repeat(32), TXB = "0x" + "b2".repeat(32), TXC = "0x" + "c3".repeat(32);
    const MOCK_DON = { version: 1, chainId: 8453, address: TEST_ADDR, updatedAt: "2026-10-27T01:02:03.000Z", scannedTo: 1, donations: [
      { txHash: TXB, time: "2026-10-27T00:10:00.000Z", token: "ETH", amount: "0.01", raw: "10000000000000000", decimals: 18, from: ADDR1, name: "하늘" },
      { txHash: TXA, logIndex: 3, time: "2026-10-26T09:00:00.000Z", token: "USDC", amount: "5.0", raw: "5000000", decimals: 6, from: ADDR0 },
      { txHash: TXC, logIndex: 1, time: "2026-10-26T08:00:00.000Z", token: "USDC", amount: "2.5", raw: "2500000", decimals: 6, from: ADDR0, name: "<img src=x onerror=alert(1)>" },
    ] };
    const dn = await donPage({ width: 1280, height: 900 }, ON, { donors: MOCK_DON, wallet: 1 });
    const dreqs = [];
    dn.dpage.on("request", (r) => dreqs.push(r.url()));
    await dn.dpage.goto("http://127.0.0.1:4173/donate.html");
    await dn.dpage.waitForSelector("#donorsList li");
    const rowsKo = await dn.dpage.locator("#donorsList li").allInnerTexts();
    check("list: 3 rows, newest first (named 하늘 first)", rowsKo.length === 3 && /^하늘/.test(rowsKo[0]) && /0\.01 ETH/.test(rowsKo[0]) && /2026-10-27/.test(rowsKo[0]), rowsKo.join(" / "));
    const short0 = DNm.shortAddr(ADDR0);
    check("list: unsigned donor shown as anonymous with short address + amount + date", rowsKo[1].includes(`익명 후원자 (${short0})`) && /5\.00 USDC/.test(rowsKo[1]) && /2026-10-26/.test(rowsKo[1]), rowsKo[1]);
    check("list: hostile/invalid name falls back to anonymous and injects no element", /익명 후원자/.test(rowsKo[2]) && (await dn.dpage.locator("#donorsList img").count()) === 0 && !rowsKo[2].includes("onerror"), rowsKo[2]);
    check("list: totals per token (7.50 USDC + 0.01 ETH)", /7\.50 USDC \+ 0\.01 ETH/.test(await dn.dpage.textContent("#donorsTotal")), await dn.dpage.textContent("#donorsTotal"));
    const hrefs = await dn.dpage.$$eval("#donorsList a", (as) => as.map((a) => a.href + "|" + a.rel));
    check("list: basescan tx links (noopener noreferrer)", hrefs[0] === `https://basescan.org/tx/${TXB}|noopener noreferrer`, hrefs[0]);
    check("list: states updated date", /2026-10-27/.test(await dn.dpage.textContent("#donorsUpdated")));
    await dn.dpage.screenshot({ path: path.join(SHOTS, "donors-list-desktop-ko.png"), fullPage: true });
    await dn.dpage.click('[data-lang="en"]');
    const rowsEn = await dn.dpage.locator("#donorsList li").allInnerTexts();
    check("list (en): Anonymous supporter + View transaction + Received so far", rowsEn[1].includes(`Anonymous supporter (${short0})`) && /View transaction/.test(rowsEn[1]) && /Received so far: 7\.50 USDC \+ 0\.01 ETH/.test(await dn.dpage.textContent("#donorsTotal")), rowsEn[1]);
    check("list: only the local origin was contacted (donors.json is a same-origin GET)", dreqs.every((u) => new URL(u).origin === "http://127.0.0.1:4173") && dreqs.some((u) => u.endsWith("/donors.json")), dreqs.join(","));
    await dn.dpage.click('[data-lang="ko"]');

    // signing: wallet #1 (the sender of TXB) signs a name -> downloaded JSON -> operator verifier accepts
    await dn.dpage.fill("#signName", "하늘 님");
    await dn.dpage.fill("#signTx", TXB.toUpperCase().replace("0X", "0x"));
    const [dlFile] = await Promise.all([dn.dpage.waitForEvent("download"), dn.dpage.click("#signBtn")]);
    const signedPath = path.join(tmp, "signed1.json");
    await dlFile.saveAs(signedPath);
    const signed = JSON.parse(fs.readFileSync(signedPath, "utf8"));
    check("sign: file has name/tx/signer/message/signature and the exact EIP-191 message", signed.name === "하늘 님" && signed.txHash === TXB && signed.signer.toLowerCase() === ADDR1.toLowerCase() && signed.message === `Ieum Ledger donor name: 하늘 님 | tx: ${TXB}` && /^0x[0-9a-f]{130}$/i.test(signed.signature), JSON.stringify(signed).slice(0, 160));
    const okMsg = await dn.dpage.textContent("#signMsg");
    check("sign: page tells the donor to email the file", /문의 메일/.test(okMsg) && (await dn.dpage.getAttribute("#signMail", "href")) === "mailto:dkakrptehsrk@gmail.com", okMsg);
    const don = MOCK_DON.donations.map((d) => ({ ...d, txHash: d.txHash.toLowerCase() }));
    const v = verify(signed, don);
    check("add-donor-name: genuine signature accepted (signer == tx sender)", v.ok === true && v.entry.name === "하늘 님", JSON.stringify(v));
    const badSig = (label, obj, exp) => { const r = verify(obj, don); check(`add-donor-name rejects: ${label}`, r.ok === false && (!exp || r.reason.includes(exp)), r.reason); };
("message edited after signing (name/message mismatch)", { ...signed, name: "다른이름" }, "message does not match");
("name AND message rewritten, old signature kept", { ...signed, name: "다른이름", message: DNm.message("다른이름", TXB) }, "signer");
("signature from a different wallet (not the sender)", (() => { const w0 = new ethers.Wallet(KEYS[0]); const m = DNm.message("하늘 님", TXB); return { ...signed, signer: w0.address, signature: w0.signMessageSync(m) }; })(), "not the sender");
("signer field claims the sender but signature is from another key", (() => { const w0 = new ethers.Wallet(KEYS[0]); return { ...signed, signature: w0.signMessageSync(signed.message) }; })(), "does not match signer");
("signature for another tx reused", { ...signed, txHash: TXA, message: DNm.message("하늘 님", TXA) }, "signer");
("tx not in donors.json", (() => { const w1 = new ethers.Wallet(KEYS[1]); const tx = "0x" + "d4".repeat(32); const m = DNm.message("하늘", tx); return { name: "하늘", txHash: tx, signer: w1.address, message: m, signature: w1.signMessageSync(m) }; })(), "not in donors.json");
("garbage signature", { ...signed, signature: "0x1234" }, "bad signature");
    for (const [nm, why] of [["http evil", "bad"], ["a@b.co", "chars"], ["call 01012345678", "digits"], ["씨발", "bad"], ["", "empty"], ["가".repeat(25), "long"], ["tel|x", "chars"]]) {
      const w1 = new ethers.Wallet(KEYS[1]); const m = DNm.message(nm, TXB);
      const r = verify({ name: nm, txHash: TXB, signer: w1.address, message: m, signature: w1.signMessageSync(m) }, don);
      check(`add-donor-name rejects name "${nm.slice(0, 16)}" (${why})`, r.ok === false && r.reason.includes(why), r.reason);
    }
    // page-side validation: URL name blocked before the wallet is even asked
    await dn.dpage.fill("#signName", "http://evil.example");
    let downloaded = false; dn.dpage.once("download", () => { downloaded = true; });
    await dn.dpage.click("#signBtn");
    check("sign: URL-like name is refused on the page with a message, no file", /글자·숫자·공백/.test(await dn.dpage.textContent("#signMsg")) && !downloaded);
    await dn.dpage.fill("#signName", "하늘"); await dn.dpage.fill("#signTx", "0x1234");
    await dn.dpage.click("#signBtn");
    check("sign: malformed tx hash refused", /거래 해시 형식/.test(await dn.dpage.textContent("#signMsg")));
    await dn.dpage.click('[data-lang="en"]');
    check("sign: after switching to EN the shown tx-hash error is re-translated", /transaction hash format/i.test(await dn.dpage.textContent("#signMsg")) && !/[가-힣]/.test(await dn.dpage.textContent("#signMsg")));
    await dn.dpage.screenshot({ path: path.join(SHOTS, "donors-sign-desktop-en.png"), fullPage: true });
    await dn.dctx.close();

    // connected wallet != tx sender -> page refuses (no file)
    const wrong = await donPage({ width: 1280, height: 900 }, ON, { donors: MOCK_DON, wallet: 0 });
    await wrong.dpage.goto("http://127.0.0.1:4173/donate.html");
    await wrong.dpage.waitForSelector("#donorsList li");
    await wrong.dpage.fill("#signName", "하늘"); await wrong.dpage.fill("#signTx", TXB);
    let wrongDl = false; wrong.dpage.once("download", () => { wrongDl = true; });
    await wrong.dpage.click("#signBtn");
    await wrong.dpage.waitForFunction(() => document.getElementById("signMsg").textContent.length > 0);
    check("sign: wallet that is not the sender is refused, no file", /보낸 주소와 다릅니다/.test(await wrong.dpage.textContent("#signMsg")) && !wrongDl);
    await wrong.dctx.close();

    // empty list, load failure, no wallet
    const emp = await donPage({ width: 1280, height: 900 }, ON, { donors: { version: 1, chainId: 8453, donations: [] } });
    await emp.dpage.goto("http://127.0.0.1:4173/donate.html");
    await emp.dpage.waitForFunction(() => !document.getElementById("donorsEmpty").hidden);
    check("empty: plain 'no supporters yet' text, no list, no total", /아직 후원이 없어요\. 첫 후원자가 되어 주세요/.test(await emp.dpage.textContent("#donorsEmpty")) && (await emp.dpage.locator("#donorsList li").count()) === 0 && await emp.dpage.locator("#donorsTotal").isHidden());
    check("no wallet in browser: sign form hidden, explanation shown", await emp.dpage.locator("#signNoWallet").isVisible() && await emp.dpage.locator("#signForm").isHidden());
    await emp.dpage.screenshot({ path: path.join(SHOTS, "donors-empty-desktop-ko.png"), fullPage: true });
    await emp.dpage.click('[data-lang="en"]');
    check("empty (en): 'No supporters yet. Be the first.'", /No supporters yet\. Be the first\./.test(await emp.dpage.textContent("#donorsEmpty")));
    await emp.dctx.close();
    const nf = await donPage({ width: 1280, height: 900 }, ON, { donors: null });
    await nf.dpage.goto("http://127.0.0.1:4173/donate.html");
    await nf.dpage.waitForFunction(() => !document.getElementById("donorsFail").hidden);
    check("load failure: shows a plain error, address/QR still shown", /불러오지 못했어요/.test(await nf.dpage.textContent("#donorsFail")) && await nf.dpage.locator("#donAddress").isVisible());
    await nf.dctx.close();
    const mob = await donPage({ width: 390, height: 844 }, ON, { donors: MOCK_DON, wallet: 1 });
    await mob.dpage.goto("http://127.0.0.1:4173/donate.html");
    await mob.dpage.waitForSelector("#donorsList li");
    check("mobile: donor list page has no horizontal overflow", (await mob.dpage.evaluate(() => document.documentElement.scrollWidth)) <= 390);
    await mob.dpage.screenshot({ path: path.join(SHOTS, "donors-list-mobile-390-ko.png"), fullPage: true });
    await mob.dctx.close();
    // the generated file in the repo itself (what is deployed)
    const real = await donPage({ width: 1280, height: 900 }, ON);
    await real.dpage.goto("http://127.0.0.1:4173/donate.html");
    await real.dpage.waitForFunction(() => !document.getElementById("donorsEmpty").hidden || !document.getElementById("donorsFail").hidden || document.querySelectorAll("#donorsList li").length > 0);
    const realJson = JSON.parse(fs.readFileSync(path.join(REG_DIR, "donors.json"), "utf8"));
    check("committed donors.json renders consistently (empty text iff 0 donations)", realJson.donations.length === 0 ? await real.dpage.locator("#donorsEmpty").isVisible() : (await real.dpage.locator("#donorsList li").count()) > 0);
    await real.dctx.close();
  } finally {
    if (browser) await browser.close();
    server.close();
    node.kill();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(`\nE2E result: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
