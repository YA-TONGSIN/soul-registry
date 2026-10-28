#!/usr/bin/env node
// record-score.js - record a SOUL VERIFY score on the Ieum Ledger (SoulRegistry.recordCarryOver).
// DEFAULT IS A DRY RUN: nothing is sent unless DRY=0 is set explicitly.
//
//   node scripts/record-score.js --agent 1 --soul-hash 0x<64hex> --model provider/model@date --score 0.82 --evidence-url https://doi.org/10.5281/zenodo.XXXX
//   DRY=0 IEUM_OWNER_KEY=0x... node scripts/record-score.js --network localhost ...      (sends a transaction)
//
// What goes on-chain (contract recordCarryOver(agentId, soulHash, fromModel, toModel, reportHash, scoreBps)):
//   soulHash  = a SOUL version already recorded for the agent (--soul-hash, or --soul-file: the matching recorded version)
//   toModel   = --model (the model the SOUL was carried to), fromModel = --from-model (optional)  [<= 64 bytes each]
//   scoreBps  = round(score * 10000), score in 0..1
//   reportHash = --report-hash 0x.. | SHA-256 of --report-file | SHA-256 of the --evidence-url string (UTF-8)
// The URL itself is NOT stored on-chain (the contract has no URL field); only its hash is. To show the link next to
// the score, the register page reads register/evidence.js ({reportHash: url}); the page links it only if
// sha256(url) == reportHash. Use --save-evidence to merge the entry into register/evidence.js.
//
// Safety: sending needs DRY=0 + IEUM_OWNER_KEY (env var; this script never reads key files) and is refused on any
// network except localhost unless --allow-public is passed. The score is the owner's own report (see docs/roadmap_v2.md).
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const MAX_MODEL = 64, MAX_URI = 200;
const ROOT = path.join(__dirname, "..");
const EVIDENCE_FILE = path.join(ROOT, "register", "evidence.js");
const DEFAULT_RPC = { baseSepolia: "https://sepolia.base.org", localhost: "http://127.0.0.1:8545" };
const ABI = [
  "function getAgent(uint256) view returns (tuple(uint256 id, string name, string note, address owner, uint64 createdAt, string metaURI, bytes32 headHash, uint32 recordCount))",
  "function getHistory(uint256) view returns (tuple(uint256 agentId, bytes32 soulHash, bytes32 parentHash, string note, uint64 timestamp)[])",
  "function recordCarryOver(uint256 agentId, bytes32 soulHash, string fromModel, string toModel, bytes32 reportHash, uint16 scoreBps)",
];
const isHash = (h) => /^0x[0-9a-fA-F]{64}$/.test(h);
const sha256Hex = (buf) => "0x" + crypto.createHash("sha256").update(buf).digest("hex");
const bytesOf = (s) => Buffer.byteLength(s, "utf8");

function parseArgs(argv) {
  const o = { network: "localhost", saveEvidence: false, allowPublic: false };
  const names = { "--agent": "agent", "--soul-hash": "soulHash", "--soul-file": "soulFile", "--model": "model", "--from-model": "fromModel", "--score": "score", "--evidence-url": "url", "--report-hash": "reportHash", "--report-file": "reportFile", "--rpc": "rpc", "--network": "network", "--contract": "contract" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (names[a]) { if (i + 1 >= argv.length) throw new Error(`${a} needs a value`); o[names[a]] = argv[++i]; }
    else if (a === "--save-evidence") o.saveEvidence = true;
    else if (a === "--allow-public") o.allowPublic = true;
    else if (a === "-h" || a === "--help") o.help = true;
    else throw new Error(`unknown argument ${a}`);
  }
  return o;
}

function normalizeLF(buf) {
  const out = [];
  for (let i = 0; i < buf.length; i++) {
    const c = buf[i];
    if (c === 0x0d) { out.push(0x0a); if (buf[i + 1] === 0x0a) i++; } else out.push(c);
  }
  return Buffer.from(out);
}

// "0.82" -> 8200. Strict decimal 0..1 (no NaN / exponent / percent); rounds to basis points.
function scoreToBps(s) {
  if (typeof s !== "string" || !/^(0(\.\d+)?|1(\.0+)?)$/.test(s.trim())) throw new Error("--score must be a decimal between 0 and 1 (e.g. 0.82)");
  return Math.round(Number(s) * 10000);
}

function checkUrl(u) {
  if (!/^https:\/\/[^\s]+$/.test(u)) throw new Error("--evidence-url must be an https:// URL without spaces");
  if (bytesOf(u) > MAX_URI) throw new Error(`--evidence-url is longer than ${MAX_URI} bytes`);
  return u;
}

// Resolve everything the transaction needs from args; pure (no network). Chain-dependent soulHash from --soul-file is handled by caller.
function buildCall(o) {
  if (!o.agent || !/^[1-9]\d*$/.test(o.agent)) throw new Error("--agent <id> is required (positive integer)");
  if (!o.model) throw new Error("--model is required (the model the SOUL was carried to)");
  const fromModel = o.fromModel || "";
  for (const [k, v] of [["--model", o.model], ["--from-model", fromModel]]) if (bytesOf(v) > MAX_MODEL) throw new Error(`${k} is longer than ${MAX_MODEL} bytes`);
  const scoreBps = scoreToBps(o.score);
  const srcs = [o.url, o.reportHash, o.reportFile].filter((x) => x !== undefined).length;
  if (srcs === 0) throw new Error("evidence required: --evidence-url, --report-file or --report-hash");
  let reportHash, url = null;
  if (o.reportHash !== undefined) { if (!isHash(o.reportHash)) throw new Error("--report-hash must be 0x + 64 hex digits"); reportHash = o.reportHash.toLowerCase(); }
  else if (o.reportFile !== undefined) reportHash = sha256Hex(fs.readFileSync(o.reportFile));
  if (o.url !== undefined) {
    url = checkUrl(o.url);
    const uh = sha256Hex(Buffer.from(url, "utf8"));
    if (reportHash === undefined) reportHash = uh; // URL string is the evidence pointer
  }
  if (reportHash === "0x" + "0".repeat(64)) throw new Error("report hash must not be zero");
  return { agentId: BigInt(o.agent), fromModel, toModel: o.model, reportHash, scoreBps, url };
}

function readEvidence(file = EVIDENCE_FILE) {
  if (!fs.existsSync(file)) return {};
  const m = /window\.IEUM_EVIDENCE\s*=\s*(\{[\s\S]*?\});/.exec(fs.readFileSync(file, "utf8"));
  return m ? JSON.parse(m[1]) : {};
}
function saveEvidence(reportHash, url, file = EVIDENCE_FILE) {
  if (sha256Hex(Buffer.from(url, "utf8")) !== reportHash) throw new Error("cannot save evidence: sha256(url) != reportHash (page would not link it)");
  const all = readEvidence(file);
  all[reportHash] = url;
  fs.writeFileSync(file, "// reportHash -> public evidence URL. The register page links a URL only if sha256(url) equals the hash.\nwindow.IEUM_EVIDENCE = " + JSON.stringify(all, null, 2) + ";\n");
}

async function run(argv, deps = {}) {
  const out = deps.log || console.log;
  const env = deps.env || process.env;
  const dry = env.DRY !== "0";
  let o;
  try { o = parseArgs(argv); } catch (e) { out(`ERROR ${e.message}`); return 2; }
  if (o.help) { out("usage: node scripts/record-score.js --agent <id> (--soul-hash 0x.. | --soul-file path) --model <name> [--from-model <name>] --score <0..1> (--evidence-url https://.. | --report-file path | --report-hash 0x..) [--network localhost|baseSepolia] [--save-evidence]   (DRY=1 by default; DRY=0 sends)"); return 0; }
  let call;
  try {
    call = buildCall(o);
    if (!!o.soulHash === !!o.soulFile) throw new Error("give exactly one of --soul-hash or --soul-file");
    if (o.soulHash) { if (!isHash(o.soulHash)) throw new Error("--soul-hash must be 0x + 64 hex digits"); call.soulHash = o.soulHash.toLowerCase(); }
  } catch (e) { out(`ERROR ${e.message}`); return 2; }

  // Connect (read-only unless DRY=0)
  let reg = deps.registry, signerAddr = null;
  try {
    if (!reg) {
      const { ethers } = require("ethers");
      const dep = JSON.parse(fs.readFileSync(path.join(ROOT, "deployments", `${o.network}.json`), "utf8"));
      const url = o.rpc || (o.network === "baseSepolia" && env.BASE_SEPOLIA_RPC) || DEFAULT_RPC[o.network];
      if (!url) throw new Error(`no RPC for network ${o.network}; pass --rpc`);
      const provider = new ethers.JsonRpcProvider(url, undefined, { staticNetwork: true, batchMaxCount: 1 });
      const net = await provider.getNetwork();
      if (Number(net.chainId) !== dep.chainId) throw new Error(`RPC chainId ${net.chainId} != deployment ${dep.chainId}`);
      let runner = provider;
      if (!dry) {
        if (o.network !== "localhost" && !o.allowPublic) throw new Error(`refusing to send on '${o.network}' without --allow-public (public networks need the owner's explicit approval)`);
        if (!env.IEUM_OWNER_KEY) throw new Error("DRY=0 needs IEUM_OWNER_KEY in the environment (this script never reads key files)");
        runner = new ethers.Wallet(env.IEUM_OWNER_KEY, provider);
        signerAddr = runner.address;
      }
      reg = new ethers.Contract(o.contract || dep.address, ABI, runner);
    }
    const agent = await reg.getAgent(call.agentId);
    const hist = await reg.getHistory(call.agentId);
    if (!call.soulHash) {
      const buf = fs.readFileSync(o.soulFile);
      const cands = [sha256Hex(normalizeLF(buf)), sha256Hex(buf)];
      const recorded = hist.map((r) => r.soulHash.toLowerCase());
      call.soulHash = cands.find((h) => recorded.includes(h));
      if (!call.soulHash) throw new Error("--soul-file matches no recorded version of this agent (record it first with appendSoul)");
    }
    const idx = hist.findIndex((r) => r.soulHash.toLowerCase() === call.soulHash);
    if (idx < 0) throw new Error(`soulHash is not recorded for agent #${call.agentId} (contract would revert UnknownSoul)`);
    call.version = idx + 1;
    if (!dry && signerAddr && agent.owner.toLowerCase() !== signerAddr.toLowerCase()) throw new Error(`signer ${signerAddr} is not the owner of agent #${call.agentId}`);
  } catch (e) { out(`ERROR ${e.shortMessage || e.message}`); return 2; }

  const plan = { agentId: call.agentId.toString(), version: call.version, soulHash: call.soulHash, fromModel: call.fromModel, toModel: call.toModel, scoreBps: call.scoreBps, reportHash: call.reportHash, evidenceUrl: call.url };
  out(`${dry ? "DRY RUN (nothing sent; set DRY=0 to send)" : "SENDING"}: recordCarryOver ${JSON.stringify(plan)}`);
  if (dry) { if (o.saveEvidence && call.url) { saveEvidence(call.reportHash, call.url); out("evidence saved to register/evidence.js (local file only)"); } return 0; }
  try {
    const tx = await reg.recordCarryOver(call.agentId, call.soulHash, call.fromModel, call.toModel, call.reportHash, call.scoreBps);
    const rc = await tx.wait();
    out(`recorded: tx ${tx.hash} block ${rc.blockNumber}`);
    if (o.saveEvidence && call.url) { saveEvidence(call.reportHash, call.url); out("evidence saved to register/evidence.js (local file only)"); }
    return 0;
  } catch (e) { out(`ERROR send failed: ${e.shortMessage || e.message}`); return 2; }
}

if (require.main === module) {
  run(process.argv.slice(2)).then((c) => { process.exitCode = c; }, (e) => { console.error(`ERROR ${e.message || e}`); process.exitCode = 2; });
}

module.exports = { parseArgs, scoreToBps, buildCall, readEvidence, saveEvidence, sha256Hex, run };
