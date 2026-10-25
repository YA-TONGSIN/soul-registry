#!/usr/bin/env node
// Ieum Ledger · build register/donors.json from public Base-mainnet data. READ-ONLY: no transaction is sent, no key is used.
//   USDC  : eth_getLogs Transfer(to = donation address) on the public RPC (chunked, retried; the RPC rate-limits).
//   ETH   : free Blockscout API txlist (no key). Failed txs and zero/dust amounts are ignored.
// Names: data/donor-names.json (verified signatures, written by add-donor-name.js). Hide list: data/donor-hide.json.
// Usage: node scripts/update-donors.js [--from <blockNumber>] [--out <file>] [--rpc <url>] [--blockscout <url>]
//   First run scans ~6 days back (the donation page went live 2026-10-26); later runs continue from `scannedTo`.
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
const DN = require("../register/donor-name.js");

const ROOT = path.join(__dirname, "..");
const cfgSrc = fs.readFileSync(path.join(ROOT, "register", "config.js"), "utf8");
const ADDRESS = (cfgSrc.match(/donation:\s*\{[\s\S]*?address:\s*"(0x[0-9a-fA-F]{40})"/) || [])[1];
const CHAIN_ID = 8453;
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // Circle: USDC on Base (developers.circle.com/stablecoins/usdc-contract-addresses)
const TRANSFER = ethers.id("Transfer(address,address,uint256)");
const MIN = { USDC: 10000n, ETH: 10n ** 13n }; // 0.01 USDC, 0.00001 ETH — below this is treated as dust / address-poisoning spam
const CHUNK = 20000;

function arg(name, def) { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : def; }
// mainnet.base.org answers eth_getLogs with 429 "request limit reached" (checked 2026-10-26), so a second public RPC is tried first/as fallback.
const RPCS = arg("--rpc", "https://base-rpc.publicnode.com,https://mainnet.base.org").split(",");
const BLOCKSCOUT = arg("--blockscout", "https://base.blockscout.com/api");
const OUT = arg("--out", path.join(ROOT, "register", "donors.json"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function rpc(method, params) {
  let last = "";
  for (let attempt = 0; attempt < 6; attempt++) {
    for (const url of RPCS) {
      try {
        const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
        const j = await res.json().catch(() => ({}));
        if (j.result !== undefined && !j.error) return j.result;
        last = `${url}: ${(j.error && j.error.message) || "HTTP " + res.status}`;
      } catch (e) { last = `${url}: ${e.message}`; }
    }
    await sleep(1500 * (attempt + 1));
  }
  throw new Error(`${method}: gave up after retries (${last})`);
}
const q = (n) => "0x" + BigInt(n).toString(16);
const key = (d) => `${d.txHash}:${d.logIndex === undefined ? "n" : d.logIndex}:${d.token}`;
const iso = (sec) => new Date(Number(sec) * 1000).toISOString();

function readJson(file, def) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return def; } }

async function main() {
  if (!ADDRESS) throw new Error("donation address not found in register/config.js");
  const head = parseInt(await rpc("eth_blockNumber", []), 16);
  const prev = readJson(OUT, null);
  const known = new Map(((prev && prev.donations) || []).map((d) => [key(d), d]));
  const fromArg = arg("--from", null);
  let from = fromArg ? Number(fromArg) : prev && Number.isInteger(prev.scannedTo) ? Math.max(0, prev.scannedTo - 20) : head - 6 * 43200;
  const to = head - 3; // a few blocks of margin against reorgs
  console.log(`address ${ADDRESS}\nscanning USDC logs ${from}..${to} (${Math.ceil((to - from + 1) / CHUNK)} chunks)`);

  // ── USDC ──
  const topicTo = "0x" + "0".repeat(24) + ADDRESS.slice(2).toLowerCase();
  const logs = [];
  for (let a = from; a <= to; a += CHUNK) {
    const b = Math.min(a + CHUNK - 1, to);
    const r = await rpc("eth_getLogs", [{ fromBlock: q(a), toBlock: q(b), address: USDC, topics: [TRANSFER, null, topicTo] }]);
    logs.push(...r);
    await sleep(400);
  }
  const blockTime = new Map();
  for (const l of logs) {
    const raw = BigInt(l.data);
    if (raw < MIN.USDC) continue;
    const bn = parseInt(l.blockNumber, 16);
    if (!blockTime.has(bn)) blockTime.set(bn, parseInt((await rpc("eth_getBlockByNumber", [q(bn), false])).timestamp, 16));
    const d = { txHash: l.transactionHash.toLowerCase(), logIndex: parseInt(l.logIndex, 16), time: iso(blockTime.get(bn)), token: "USDC", amount: ethers.formatUnits(raw, 6), raw: raw.toString(), decimals: 6, from: ethers.getAddress("0x" + l.topics[1].slice(26)) };
    known.set(key(d), d);
  }

  // ── ETH (native, normal transactions) ──
  let eth = 0;
  for (let page = 1; page <= 20; page++) {
    const url = `${BLOCKSCOUT}?module=account&action=txlist&address=${ADDRESS}&sort=desc&page=${page}&offset=100`;
    let j;
    for (let attempt = 0; attempt < 6; attempt++) {
      // Blockscout's Cloudflare rejects Node's default User-Agent (403 challenge); a "Mozilla/5.0 (compatible; …)" UA passes.
      try { const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (compatible; IeumLedgerDonors/1.0; read-only)", accept: "application/json" } }); if (res.ok) { j = await res.json(); break; } } catch { /* retry */ }
      await sleep(1500 * (attempt + 1));
    }
    if (!j) throw new Error("blockscout: no response");
    const list = Array.isArray(j.result) ? j.result : [];
    if (j.status === "0" && !/no transactions/i.test(j.message || "") ) throw new Error("blockscout: " + (j.message || "error") + " " + (typeof j.result === "string" ? j.result : ""));
    for (const t of list) {
      if (!t.to || t.to.toLowerCase() !== ADDRESS.toLowerCase()) continue;
      if (t.isError !== "0" || (t.txreceipt_status && t.txreceipt_status !== "1")) continue;
      const raw = BigInt(t.value);
      if (raw < MIN.ETH) continue;
      const d = { txHash: t.hash.toLowerCase(), time: iso(t.timeStamp), token: "ETH", amount: ethers.formatEther(raw), raw: raw.toString(), decimals: 18, from: ethers.getAddress(t.from) };
      if (!known.has(key(d))) eth++;
      known.set(key(d), d);
    }
    if (list.length < 100) break;
    await sleep(500);
  }

  // ── names (signature-verified) + hide list ──
  const names = readJson(path.join(ROOT, "data", "donor-names.json"), {});
  const hide = new Set(readJson(path.join(ROOT, "data", "donor-hide.json"), []).map(DN.normTx));
  const donations = [...known.values()]
    .filter((d) => !hide.has(d.txHash))
    .map((d) => {
      const n = names[d.txHash];
      const out = { ...d }; delete out.name;
      if (n && DN.check(n.name).ok && n.signer && n.signer.toLowerCase() === d.from.toLowerCase()) out.name = DN.check(n.name).name;
      return out;
    })
    .sort((a, b) => (a.time < b.time ? 1 : a.time > b.time ? -1 : 0));

  const out = { version: 1, chainId: CHAIN_ID, address: ADDRESS, usdc: USDC, updatedAt: new Date().toISOString(), scannedTo: to, donations };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
  console.log(`USDC transfers in range: ${logs.length}  ·  new ETH: ${eth}  ·  donations listed: ${donations.length}  ·  wrote ${OUT}`);
}
main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });

