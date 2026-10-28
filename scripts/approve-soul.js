#!/usr/bin/env node
// approve-soul.js - human decision on a pending item from watch-soul.js (roadmap v2 feature 2).
// DEFAULT IS A DRY RUN: nothing is signed or written unless DRY=0 is set explicitly. No transaction is ever sent here.
//
//   node scripts/approve-soul.js approve a1-1a2b3c4d --file C:\path\SOUL.md [--network localhost]       (DRY: prints the entry)
//   $env:DRY=0; $env:IEUM_OWNER_KEY="0x..."; node scripts/approve-soul.js approve a1-1a2b3c4d --file C:\path\SOUL.md
//   node scripts/approve-soul.js reject a1-1a2b3c4d [--reason "..."]       (moves the item to rejected/, marked suspected tampering)
//
// approve: re-reads --file and refuses unless its LF fingerprint still equals the pending fingerprint (so a file swapped after
//   detection can never be signed). Signs the EIP-712 SoulEntry with the owner key (env IEUM_OWNER_KEY only; this script never
//   reads key files; the key must be the agent's on-chain owner), writes batches/signed-a<agent>-<hash8>.json, moves the item
//   to approved/, and stores the per-line hashes of the approved file in state/ (used by watch-soul.js to count changed lines).
// reject: no key, no file read. Item goes to rejected/ with flag "suspected-tampering" (label "몰래 바뀜 의심"). watch-soul.js
//   will not re-create an item for a rejected fingerprint (exit 3), so restore the file or investigate.
// Anchoring the signed entries on-chain is done by the existing anchorBatch flow (Merkle root via lib/merkle.js, see demo-batch.js).
//
// Exit codes: 0 = done (or DRY plan printed) / 2 = refused or error.
const fs = require("fs");
const path = require("path");
const B = require("../lib/soul-baseline");

const ROOT = path.join(__dirname, "..");
const DEFAULT_RPC = { baseSepolia: "https://sepolia.base.org", localhost: "http://127.0.0.1:8545" };
const ABI = [
  "function getAgent(uint256) view returns (tuple(uint256 id, string name, string note, address owner, uint64 createdAt, string metaURI, bytes32 headHash, uint32 recordCount))",
];
const NOTE = "auto: file fingerprint change detected; human-approved";

function parseArgs(argv) {
  const o = { network: "localhost", positional: [] };
  const names = { "--file": "file", "--reason": "reason", "--rpc": "rpc", "--network": "network", "--contract": "contract", "--pending-dir": "pendingDir", "--approved-dir": "approvedDir", "--rejected-dir": "rejectedDir", "--batches-dir": "batchesDir", "--state-dir": "stateDir" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (names[a]) { if (i + 1 >= argv.length) throw new Error(`${a} needs a value`); o[names[a]] = argv[++i]; }
    else if (a === "-h" || a === "--help") o.help = true;
    else if (a.startsWith("--")) throw new Error(`unknown option ${a}`);
    else o.positional.push(a);
  }
  return o;
}

function loadPending(dir, ref) {
  const id = path.basename(ref).replace(/\.json$/, "");
  if (!/^a\d+-[0-9a-f]{8}$/.test(id)) throw new Error(`bad pending id '${ref}' (expected a<agent>-<hash8>)`);
  const file = path.join(dir, `${id}.json`);
  if (!fs.existsSync(file)) throw new Error(`no pending item ${id} in ${dir}`);
  const item = JSON.parse(fs.readFileSync(file, "utf8"));
  if (item.kind !== "soul-pending" || item.status !== "pending" || !B.isHash(item.soulHash) || !B.isHash(item.parentHash)) throw new Error(`${id} is not a valid pending item`);
  return { id, file, item };
}

function move(item, file, destDir, patch) {
  fs.mkdirSync(destDir, { recursive: true });
  const dest = path.join(destDir, path.basename(file));
  fs.writeFileSync(dest, JSON.stringify({ ...item, ...patch }, null, 2) + "\n", { flag: "wx" });
  fs.rmSync(file);
  return dest;
}

async function connect(o, deps, env) {
  if (deps.registry) {
    const { domainOf } = require("../lib/merkle");
    return { reg: deps.registry, domain: await domainOf(deps.registry) };
  }
  const { ethers } = require("ethers");
  const dep = JSON.parse(fs.readFileSync(path.join(ROOT, "deployments", `${o.network}.json`), "utf8"));
  const url = o.rpc || (o.network === "baseSepolia" && env.BASE_SEPOLIA_RPC) || DEFAULT_RPC[o.network];
  if (!url) throw new Error(`no RPC for network ${o.network}; pass --rpc`);
  const provider = new ethers.JsonRpcProvider(url, undefined, { staticNetwork: true, batchMaxCount: 1 });
  const net = await provider.getNetwork();
  if (Number(net.chainId) !== dep.chainId) throw new Error(`RPC chainId ${net.chainId} != deployment ${dep.chainId}`);
  const address = o.contract || dep.address;
  return { reg: new ethers.Contract(address, ABI, provider), domain: { name: "SoulRegistry", version: "1", chainId: net.chainId, verifyingContract: address } };
}

async function run(argv, deps = {}) {
  const out = deps.log || console.log;
  const env = deps.env || process.env;
  const dry = env.DRY !== "0";
  let o;
  try { o = parseArgs(argv); } catch (e) { out(`ERROR ${e.message}`); return 2; }
  if (o.help || o.positional.length === 0) { out("usage: node scripts/approve-soul.js approve|reject <pending id> [--file SOUL.md] [--reason text] [--network localhost|baseSepolia]   (approve is DRY unless DRY=0; needs IEUM_OWNER_KEY)"); return o.help ? 0 : 2; }
  const dirs = {
    pending: o.pendingDir || path.join(ROOT, "pending"),
    approved: o.approvedDir || path.join(ROOT, "approved"),
    rejected: o.rejectedDir || path.join(ROOT, "rejected"),
    batches: o.batchesDir || path.join(ROOT, "batches"),
    state: o.stateDir || path.join(ROOT, "state"),
  };
  try {
    const [action, ref] = o.positional;
    if (o.positional.length !== 2 || !["approve", "reject"].includes(action)) throw new Error("usage: approve|reject <pending id>");
    const { id, file, item } = loadPending(dirs.pending, ref);

    if (action === "reject") {
      const dest = move(item, file, dirs.rejected, { status: "rejected", flag: "suspected-tampering", label: "몰래 바뀜 의심", reason: o.reason || null, rejectedAt: new Date().toISOString() });
      out(`REJECTED ${id}: marked "몰래 바뀜 의심" (suspected tampering) -> ${dest}. Restore the file or investigate; nothing was signed.`);
      return 0;
    }

    if (!o.file) throw new Error("approve needs --file <SOUL path> (re-checked against the pending fingerprint)");
    let buf;
    try { buf = fs.readFileSync(o.file); } catch (e) { throw new Error(`cannot read file: ${e.code || e.message}`); }
    const nowHash = B.sha256Hex(B.normalizeLF(buf));
    if (nowHash !== item.soulHash) throw new Error(`file fingerprint ${nowHash} != pending ${item.soulHash}: the file changed again after detection. Run watch-soul.js again and review the new item.`);

    const { reg, domain } = await connect(o, deps, env);
    const agent = await reg.getAgent(BigInt(item.agentId));
    if (agent.owner === "0x0000000000000000000000000000000000000000") throw new Error(`agent #${item.agentId} not found`);
    if (agent.name !== item.agentName) throw new Error(`agent name on ledger "${agent.name}" != pending "${item.agentName}"`);

    let wallet = null;
    if (!dry) {
      if (!env.IEUM_OWNER_KEY) throw new Error("DRY=0 needs IEUM_OWNER_KEY in the environment (this script never reads key files)");
      const { ethers } = require("ethers");
      wallet = new ethers.Wallet(env.IEUM_OWNER_KEY);
      if (wallet.address.toLowerCase() !== agent.owner.toLowerCase()) throw new Error(`key address ${wallet.address} is not the owner of agent #${item.agentId}`);
    }
    const entry = {
      owner: agent.owner,
      agentName: item.agentName,
      soulHash: item.soulHash,
      parentHash: item.parentHash,
      note: NOTE,
      signedAt: BigInt(Math.floor(Date.now() / 1000)),
    };
    const show = { ...entry, signedAt: entry.signedAt.toString() };
    if (dry) { out(`DRY RUN (nothing signed or written; set DRY=0 to sign): ${JSON.stringify(show)}`); return 0; }

    const { SOUL_ENTRY_TYPES } = require("../lib/merkle");
    const signature = await wallet.signTypedData(domain, SOUL_ENTRY_TYPES, entry);
    fs.mkdirSync(dirs.batches, { recursive: true });
    const signedFile = path.join(dirs.batches, `signed-${id}.json`);
    fs.writeFileSync(signedFile, JSON.stringify({ kind: "soul-signed", agentId: item.agentId, source: id, entry: show, signature }, null, 2) + "\n", { flag: "wx" });
    fs.mkdirSync(dirs.state, { recursive: true });
    fs.writeFileSync(path.join(dirs.state, `a${item.agentId}.json`), JSON.stringify({ soulHash: item.soulHash, lineHashes: B.lineHashes(buf) }) + "\n");
    move(item, file, dirs.approved, { status: "approved", approvedAt: new Date().toISOString() });
    out(`SIGNED ${id}: ${signedFile} (EIP-712, owner ${agent.owner}); no transaction sent. Anchor it with the anchorBatch flow.`);
    return 0;
  } catch (e) { out(`ERROR ${e.shortMessage || e.message}`); return 2; }
}

if (require.main === module) {
  run(process.argv.slice(2)).then((c) => { process.exitCode = c; }, (e) => { console.error(`ERROR ${e.message || e}`); process.exitCode = 2; });
}

module.exports = { parseArgs, loadPending, run, NOTE };
