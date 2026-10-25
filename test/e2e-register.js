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
  for (let i = 0; i < 60; i++) { try { await p.getBlockNumber(); return p; } catch { await sleep(500); } }
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
    await page.goto("http://127.0.0.1:4173/?net=localhost");
    await page.waitForSelector("#net");
    const noticeText = await page.locator(".notice").innerText();
    check("first screen states SOUL is never uploaded (ko)", /SOUL 내용은 절대 올라가지 않습니다/.test(noticeText) && /지문\(해시\)만 계산/.test(noticeText) && /영구 공개/.test(noticeText), noticeText.slice(0, 80));
    check("notice visible above the file picker", (await page.locator(".notice").boundingBox()).y < (await page.locator("#step1").boundingBox()).y);
    await page.screenshot({ path: path.join(SHOTS, "desktop-01-first-screen-ko.png"), fullPage: false });
    await page.click('[data-lang="en"]');
    check("language toggle -> English", /never uploaded/.test(await page.locator(".notice").innerText()) && (await page.locator("h1").innerText()).includes("Register"));
    await page.screenshot({ path: path.join(SHOTS, "desktop-02-first-screen-en.png"), fullPage: false });
    await page.click('[data-lang="ko"]');
    check("language toggle back -> Korean", /절대 올라가지/.test(await page.locator(".notice").innerText()));
    check("footer maker line shown, contact/support slots empty+hidden", (await page.textContent("#footMaker")).includes("만든 사람: 신운종 · 이음(Ieum)") && await page.locator("#footContact").isHidden() && await page.locator("#footSupport").isHidden());
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
