#!/usr/bin/env node
// check-soul.js - tamper check: compare local SOUL/MEMORY files with the Ieum Ledger. READ-ONLY (no transactions, no key).
//
//   node scripts/check-soul.js --agent 1 path\to\SOUL.md [more files...]
//   node scripts/check-soul.js SOUL.md@1 MEMORY.md@2          (per-file agentId with @)
//
// Fingerprint = SHA-256 of the file bytes after CRLF/CR -> LF normalization (same rule as the ledger's LF entries).
// The raw (un-normalized) hash is also tried, so v1-v4 (recorded from CRLF bytes) can still be recognized.
//
// Exit codes:  0 = every file equals the latest ledger version (head)
//              1 = at least one file differs (older version, or unknown to the ledger)
//              2 = could not check (bad args, missing file, RPC/agent error); takes priority over 1
//
// --batches-dir <dir>: also accept signed entries (approve-soul.js) that carry {root, proof} and verify on-chain via verifyBatchEntry
//   (i.e. approved AND anchored); they count as newer versions than the ledger head.
// Options: --agent <id>  --rpc <url>  --network baseSepolia|localhost  --contract <addr>  --json  --quiet
// RPC order: --rpc, $BASE_SEPOLIA_RPC (baseSepolia), default https://sepolia.base.org. Contract: deployments/<network>.json.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DEFAULT_RPC = { baseSepolia: "https://sepolia.base.org", localhost: "http://127.0.0.1:8545" };
const ABI = [
  "function getAgent(uint256) view returns (tuple(uint256 id, string name, string note, address owner, uint64 createdAt, string metaURI, bytes32 headHash, uint32 recordCount))",
  "function getHistory(uint256) view returns (tuple(uint256 agentId, bytes32 soulHash, bytes32 parentHash, string note, uint64 timestamp)[])",
  "function verifyBatchEntry(tuple(address owner, string agentName, bytes32 soulHash, bytes32 parentHash, string note, uint64 signedAt) e, bytes signature, bytes32[] proof, bytes32 root) view returns (bool)",
];

function normalizeLF(buf) {
  const out = [];
  for (let i = 0; i < buf.length; i++) {
    const c = buf[i];
    if (c === 0x0d) { out.push(0x0a); if (buf[i + 1] === 0x0a) i++; } else out.push(c);
  }
  return Buffer.from(out);
}
const sha256Hex = (buf) => "0x" + crypto.createHash("sha256").update(buf).digest("hex");

function parseArgs(argv) {
  const o = { files: [], json: false, quiet: false, network: "baseSepolia" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => { if (i + 1 >= argv.length) throw new Error(`${a} needs a value`); return argv[++i]; };
    if (a === "--agent") o.agent = val();
    else if (a === "--rpc") o.rpc = val();
    else if (a === "--network") o.network = val();
    else if (a === "--contract") o.contract = val();
    else if (a === "--batches-dir") o.batchesDir = val();
    else if (a === "--json") o.json = true;
    else if (a === "--quiet") o.quiet = true;
    else if (a === "-h" || a === "--help") o.help = true;
    else if (a.startsWith("--")) throw new Error(`unknown option ${a}`);
    else o.files.push(a);
  }
  return o;
}

// "C:\x\SOUL.md@3" -> { file, agentId: 3n }; only a trailing @digits counts.
function splitSpec(spec, defaultAgent) {
  const m = /^(.*)@(\d+)$/.exec(spec);
  const file = m ? m[1] : spec;
  const id = m ? m[2] : defaultAgent;
  if (id === undefined || !/^\d+$/.test(String(id)) || BigInt(id) < 1n) throw new Error(`agentId missing/invalid for ${spec} (use --agent N or file@N)`);
  return { file, agentId: BigInt(id) };
}

async function loadHistory(reg, agentId, cache, batchesDir) {
  const k = agentId.toString();
  if (!cache.has(k)) {
    const agent = await reg.getAgent(agentId);
    if (agent.owner === "0x0000000000000000000000000000000000000000") throw new Error(`agent #${k} not found`);
    const hist = await reg.getHistory(agentId);
    let chain = { name: agent.name, head: agent.headHash.toLowerCase(), hist: hist.map((r) => r.soulHash.toLowerCase()) };
    if (batchesDir) {
      // Auto-record: signed entries that are anchored AND verify on-chain (verifyBatchEntry checks the root is anchored) count as newer versions.
      const B = require("../lib/soul-baseline");
      const ok = [];
      for (const s of B.readSignedEntries(batchesDir, agentId)) {
        if (!B.isHash(s.root) || !Array.isArray(s.proof)) continue;
        const e = { ...s.entry, signedAt: BigInt(s.entry.signedAt) };
        try { if (await reg.verifyBatchEntry(e, s.signature, s.proof, s.root)) ok.push(s); } catch { /* not verifiable -> ignored */ }
      }
      chain = B.mergeSigned(chain, ok);
    }
    cache.set(k, chain);
  }
  return cache.get(k);
}

// Pure comparison, reused by tests. status: match | stale | unknown
function compare(fileBuf, chain) {
  const lf = sha256Hex(normalizeLF(fileBuf));
  const raw = sha256Hex(fileBuf);
  const tries = [["lf", lf], ["raw", raw]];
  let hit = null;
  for (const [kind, h] of tries) {
    const idx = chain.hist.lastIndexOf(h);
    if (idx >= 0 && (!hit || idx > hit.idx)) hit = { idx, kind, hash: h };
  }
  const headIdx = chain.hist.length - 1;
  if (!hit) return { status: "unknown", hash: lf, version: null, headVersion: headIdx + 1, via: null };
  return {
    status: hit.idx === headIdx ? "match" : "stale",
    hash: hit.hash, version: hit.idx + 1, headVersion: headIdx + 1, via: hit.kind,
  };
}

async function run(argv, deps = {}) {
  const out = deps.log || console.log;
  let o;
  try { o = parseArgs(argv); } catch (e) { out(`ERROR ${e.message}`); return 2; }
  if (o.help || o.files.length === 0) {
    out("usage: node scripts/check-soul.js --agent <id> <file...> [--rpc url] [--network baseSepolia|localhost] [--contract addr] [--json] [--quiet]");
    return o.help ? 0 : 2;
  }
  const results = [];
  let reg = deps.registry;
  try {
    const specs = o.files.map((s) => splitSpec(s, o.agent));
    if (!reg) {
      const { ethers } = require("ethers");
      const dep = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", `${o.network}.json`), "utf8"));
      const url = o.rpc || (o.network === "baseSepolia" && process.env.BASE_SEPOLIA_RPC) || DEFAULT_RPC[o.network];
      if (!url) throw new Error(`no RPC for network ${o.network}; pass --rpc`);
      const provider = new ethers.JsonRpcProvider(url, undefined, { staticNetwork: true, batchMaxCount: 1 });
      const net = await provider.getNetwork();
      if (Number(net.chainId) !== dep.chainId) throw new Error(`RPC chainId ${net.chainId} != deployment ${dep.chainId}`);
      reg = new ethers.Contract(o.contract || dep.address, ABI, provider);
    }
    const cache = new Map();
    for (const { file, agentId } of specs) {
      const base = { file, agentId: agentId.toString() };
      let buf;
      try { buf = fs.readFileSync(file); } catch (e) { results.push({ ...base, status: "error", error: `cannot read file: ${e.code || e.message}` }); continue; }
      try {
        const chain = await loadHistory(reg, agentId, cache, o.batchesDir);
        results.push({ ...base, agentName: chain.name, ...compare(buf, chain) });
      } catch (e) { results.push({ ...base, status: "error", error: e.shortMessage || e.message }); }
    }
  } catch (e) { out(`ERROR ${e.shortMessage || e.message}`); return 2; }

  const code = results.some((r) => r.status === "error") ? 2 : results.every((r) => r.status === "match") ? 0 : 1;
  if (o.json) out(JSON.stringify({ exitCode: code, results }, null, 2));
  else for (const r of results) {
    if (o.quiet && r.status === "match") continue;
    const tag = `${r.file} (agent #${r.agentId}${r.agentName ? ` "${r.agentName}"` : ""})`;
    if (r.status === "match") out(`OK       ${tag}: matches latest v${r.version}${r.via === "raw" ? " (raw bytes, not LF-normalized)" : ""}  ${r.hash}`);
    else if (r.status === "stale") out(`MISMATCH ${tag}: equals OLDER v${r.version}, latest is v${r.headVersion}  ${r.hash}`);
    else if (r.status === "unknown") out(`MISMATCH ${tag}: matches NO recorded version (latest v${r.headVersion}); file changed or never recorded  ${r.hash}`);
    else out(`ERROR    ${tag}: ${r.error}`);
  }
  if (!o.json && !(o.quiet && code === 0)) out(`exit ${code} (${["all match", "differs from ledger", "could not check"][code]})`);
  return code;
}

if (require.main === module) {
  run(process.argv.slice(2)).then((c) => { process.exitCode = c; }, (e) => { console.error(`ERROR ${e.message || e}`); process.exitCode = 2; });
}

module.exports = { normalizeLF, sha256Hex, compare, splitSpec, parseArgs, run };
