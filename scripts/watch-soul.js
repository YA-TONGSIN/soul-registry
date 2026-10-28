#!/usr/bin/env node
// watch-soul.js - one-shot change detector for auto-record (roadmap v2 feature 2).
// If the LF fingerprint of a SOUL file differs from the agent's latest version, it writes ONE "pending" item to pending/.
// That is ALL it does: no signing, no key, no transaction, no state writes. Safe to call from Task Scheduler / OpenClaw automation.
//
//   node scripts/watch-soul.js --agent 1 C:\path\to\SOUL.md [--network localhost|baseSepolia] [--rpc url] [--contract addr]
//        [--pending-dir D] [--rejected-dir D] [--batches-dir D] [--state-dir D] [--json]
//
// The pending item holds only: fingerprint, time, previous version, diff line count (+ agent id/name, parentHash). NEVER file content.
// "Latest version" = the ledger head, or a newer signed entry in --batches-dir (approved but not yet anchored).
// diffLines needs the previous file's per-line hashes, which approve-soul.js stores in --state-dir when a change is approved
// (null if unknown). Lines are counted as added+removed (reordering alone is not counted).
//
// Exit codes: 0 = file equals latest version, nothing to do
//             1 = a new pending item was created (a human must review it)
//             2 = could not check (bad args, missing file, RPC/agent error)
//             3 = same fingerprint is already waiting in pending/ or was rejected (rejected/): nothing new created
const fs = require("fs");
const path = require("path");
const { compare } = require("./check-soul");
const B = require("../lib/soul-baseline");

const ROOT = path.join(__dirname, "..");
const DEFAULT_RPC = { baseSepolia: "https://sepolia.base.org", localhost: "http://127.0.0.1:8545" };
const ABI = [
  "function getAgent(uint256) view returns (tuple(uint256 id, string name, string note, address owner, uint64 createdAt, string metaURI, bytes32 headHash, uint32 recordCount))",
  "function getHistory(uint256) view returns (tuple(uint256 agentId, bytes32 soulHash, bytes32 parentHash, string note, uint64 timestamp)[])",
];

function parseArgs(argv) {
  const o = { network: "baseSepolia", json: false, files: [] };
  const names = { "--agent": "agent", "--rpc": "rpc", "--network": "network", "--contract": "contract", "--pending-dir": "pendingDir", "--rejected-dir": "rejectedDir", "--batches-dir": "batchesDir", "--state-dir": "stateDir" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (names[a]) { if (i + 1 >= argv.length) throw new Error(`${a} needs a value`); o[names[a]] = argv[++i]; }
    else if (a === "--json") o.json = true;
    else if (a === "-h" || a === "--help") o.help = true;
    else if (a.startsWith("--")) throw new Error(`unknown option ${a}`);
    else o.files.push(a);
  }
  return o;
}

async function run(argv, deps = {}) {
  const out = deps.log || console.log;
  const env = deps.env || process.env;
  let o;
  try { o = parseArgs(argv); } catch (e) { out(`ERROR ${e.message}`); return 2; }
  if (o.help) { out("usage: node scripts/watch-soul.js --agent <id> <SOUL file> [--network baseSepolia|localhost] [--rpc url] [--contract addr] [--pending-dir D] [--rejected-dir D] [--batches-dir D] [--state-dir D] [--json]"); return 0; }
  const pendingDir = o.pendingDir || path.join(ROOT, "pending");
  const rejectedDir = o.rejectedDir || path.join(ROOT, "rejected");
  const batchesDir = o.batchesDir || path.join(ROOT, "batches");
  const stateDir = o.stateDir || path.join(ROOT, "state");
  try {
    if (!o.agent || !/^[1-9]\d*$/.test(o.agent)) throw new Error("--agent <id> is required (positive integer)");
    if (o.files.length !== 1) throw new Error("exactly one SOUL file path is required");
    const agentId = BigInt(o.agent);
    let buf;
    try { buf = fs.readFileSync(o.files[0]); } catch (e) { throw new Error(`cannot read file: ${e.code || e.message}`); }

    let reg = deps.registry;
    if (!reg) {
      const { ethers } = require("ethers");
      const dep = JSON.parse(fs.readFileSync(path.join(ROOT, "deployments", `${o.network}.json`), "utf8"));
      const url = o.rpc || (o.network === "baseSepolia" && env.BASE_SEPOLIA_RPC) || DEFAULT_RPC[o.network];
      if (!url) throw new Error(`no RPC for network ${o.network}; pass --rpc`);
      const provider = new ethers.JsonRpcProvider(url, undefined, { staticNetwork: true, batchMaxCount: 1 });
      const net = await provider.getNetwork();
      if (Number(net.chainId) !== dep.chainId) throw new Error(`RPC chainId ${net.chainId} != deployment ${dep.chainId}`);
      reg = new ethers.Contract(o.contract || dep.address, ABI, provider);
    }
    const agent = await reg.getAgent(agentId);
    if (agent.owner === "0x0000000000000000000000000000000000000000") throw new Error(`agent #${agentId} not found`);
    const hist = await reg.getHistory(agentId);
    let chain = {
      name: agent.name,
      head: agent.headHash.toLowerCase(),
      hist: hist.map((r) => r.soulHash.toLowerCase()),
    };
    chain = B.mergeSigned(chain, B.readSignedEntries(batchesDir, agentId));
    if (chain.hist.length === 0) throw new Error(`agent #${agentId} has no recorded version yet (record v1 first)`);

    const cmp = compare(buf, chain);
    if (cmp.status === "match") {
      out(o.json ? JSON.stringify({ exitCode: 0, status: "match", version: cmp.version }) : `OK agent #${agentId}: file equals latest v${cmp.version}; nothing to do`);
      return 0;
    }

    const lfHash = B.sha256Hex(B.normalizeLF(buf)); // pending always carries the LF fingerprint
    const id = `a${agentId}-${lfHash.slice(2, 10)}`;
    for (const [dir, label] of [[pendingDir, "waiting in pending/"], [rejectedDir, "rejected earlier (suspected tampering)"]]) {
      const f = path.join(dir, `${id}.json`);
      if (fs.existsSync(f)) {
        out(o.json ? JSON.stringify({ exitCode: 3, status: "already", id, where: label }) : `WAIT  ${id}: same fingerprint is ${label}; nothing new created`);
        return 3;
      }
    }

    let diffLines = null;
    const stateFile = path.join(stateDir, `a${agentId}.json`);
    if (fs.existsSync(stateFile)) {
      try {
        const st = JSON.parse(fs.readFileSync(stateFile, "utf8"));
        if (Array.isArray(st.lineHashes) && st.soulHash === chain.head) diffLines = B.diffLineCount(st.lineHashes, B.lineHashes(buf));
      } catch { /* unreadable state -> unknown */ }
    }
    const item = {
      kind: "soul-pending",
      id,
      status: "pending",
      agentId: agentId.toString(),
      agentName: chain.name,
      soulHash: lfHash,
      parentHash: chain.head,
      prevVersion: chain.hist.length,
      diffLines,
      detectedAt: new Date().toISOString(),
    };
    fs.mkdirSync(pendingDir, { recursive: true });
    fs.writeFileSync(path.join(pendingDir, `${id}.json`), JSON.stringify(item, null, 2) + "\n", { flag: "wx" });
    out(o.json ? JSON.stringify({ exitCode: 1, status: "pending-created", item }) : `PENDING ${id}: file differs from latest v${chain.hist.length} (${cmp.status === "stale" ? `equals older v${cmp.version}` : "matches no recorded version"}); diffLines=${diffLines === null ? "unknown" : diffLines}. Review it, then run approve-soul.js. (Fingerprint only - this does not say what changed.)`);
    return 1;
  } catch (e) { out(`ERROR ${e.shortMessage || e.message}`); return 2; }
}

if (require.main === module) {
  run(process.argv.slice(2)).then((c) => { process.exitCode = c; }, (e) => { console.error(`ERROR ${e.message || e}`); process.exitCode = 2; });
}

module.exports = { parseArgs, run };
