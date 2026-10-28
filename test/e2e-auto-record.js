// End-to-end test of auto-record against a LOCAL hardhat node (never a testnet/mainnet). Runs the real CLIs as child processes.
// Run: node test/e2e-auto-record.js      (needs: npm i, npx hardhat compile). Do not run together with e2e-register.js / e2e-lineage.js (same port 8545).
// Flow A: synthetic SOUL change -> watch-soul (pending) -> approve-soul (DRY, then DRY=0 sign) -> anchorBatch -> check-soul exit 0.
// Flow B: another synthetic change -> watch-soul -> reject ("몰래 바뀜 의심") -> nothing signed, watch stays quiet (exit 3), check-soul exit 1.
// All text is SYNTHETIC. Keys are hardhat's public default test keys #0 (deployer/anchorer) and #1 (agent owner).
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawn, spawnSync } = require("child_process");
const { ethers } = require("ethers");
const { buildTree, entryLeaf } = require("../lib/merkle");

const ROOT = path.join(__dirname, "..");
const RPC = "http://127.0.0.1:8545";
const KEY0 = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const KEY1 = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
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

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-auto-record-"));
  const d = Object.fromEntries(["pending", "rejected", "approved", "batches", "state"].map((k) => [k, path.join(dir, k)]));
  const soul = path.join(dir, "SOUL.md");
  const node = spawn(process.execPath, [path.join(ROOT, "node_modules", "hardhat", "internal", "cli", "bootstrap.js"), "node"], { cwd: ROOT, stdio: "ignore" });
  const cli = (script, args, env = {}) => {
    const r = spawnSync(process.execPath, [path.join(ROOT, "scripts", script), ...args], { cwd: ROOT, encoding: "utf8", env: { ...process.env, DRY: undefined, IEUM_OWNER_KEY: undefined, ...env } });
    return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
  };
  const dirsW = ["--pending-dir", d.pending, "--rejected-dir", d.rejected, "--batches-dir", d.batches, "--state-dir", d.state];
  const dirsA = [...dirsW, "--approved-dir", d.approved];
  const watchCli = () => cli("watch-soul.js", ["--network", "localhost", "--agent", "1", soul, ...dirsW]);
  const checkCli = (withBatches) => cli("check-soul.js", ["--network", "localhost", "--agent", "1", soul, ...(withBatches ? ["--batches-dir", d.batches] : [])]);
  const pendingIds = () => (fs.existsSync(d.pending) ? fs.readdirSync(d.pending).map((f) => f.replace(/\.json$/, "")) : []);
  try {
    const provider = await waitRpc();
    const art = JSON.parse(fs.readFileSync(path.join(ROOT, "artifacts", "contracts", "SoulRegistry.sol", "SoulRegistry.json"), "utf8"));
    const deployer = new ethers.NonceManager(new ethers.Wallet(KEY0, provider));
    const owner = new ethers.NonceManager(new ethers.Wallet(KEY1, provider));
    const dep = await new ethers.ContractFactory(art.abi, art.bytecode, deployer).deploy();
    await dep.waitForDeployment();
    const addr = await dep.getAddress();
    const saved = JSON.parse(fs.readFileSync(path.join(ROOT, "deployments", "localhost.json"), "utf8"));
    check("local deploy address equals deployments/localhost.json", addr.toLowerCase() === saved.address.toLowerCase(), addr);
    const regOwner = new ethers.Contract(addr, art.abi, owner);

    const v1 = "# Synthetic SOUL\nalpha\nbeta\n";
    await (await regOwner.registerAgent("Synthetic-AutoRecord", "e2e", "")).wait();
    await (await regOwner.appendSoul(1, sha(v1), ethers.ZeroHash, "v1")).wait();
    fs.writeFileSync(soul, v1);

    // ---- Flow A: approve ----
    let r = watchCli();
    check("A1 unchanged file: watch exit 0, no pending", r.code === 0 && pendingIds().length === 0, r.out);
    r = checkCli(true);
    check("A2 unchanged file: check-soul exit 0", r.code === 0, r.out);

    const v2 = v1 + "SECRET-MARKER-A synthetic change\n";
    fs.writeFileSync(soul, v2);
    r = watchCli();
    check("A3 changed file: watch exit 1 and exactly one pending item", r.code === 1 && pendingIds().length === 1, r.out);
    const idA = pendingIds()[0];
    const rawPending = fs.readFileSync(path.join(d.pending, `${idA}.json`), "utf8");
    const item = JSON.parse(rawPending);
    check("A4 pending holds fingerprint/time/prev version/diff lines and NO content", item.soulHash === sha(v2) && item.prevVersion === 1 && "diffLines" in item && !!item.detectedAt && !/SECRET-MARKER|alpha|beta/.test(rawPending));
    check("A5 watch again: exit 3, still one item", watch2() && pendingIds().length === 1);
    function watch2() { return watchCli().code === 3; }
    check("A6 check-soul now exit 1 (file differs from ledger)", checkCli(true).code === 1);

    r = cli("approve-soul.js", ["--network", "localhost", "approve", idA, "--file", soul, ...dirsA]);
    check("A7 approve default is DRY: exit 0, nothing written", r.code === 0 && /DRY RUN/.test(r.out) && !fs.existsSync(d.batches) && pendingIds().length === 1, r.out);
    r = cli("approve-soul.js", ["--network", "localhost", "approve", idA, "--file", soul, ...dirsA], { DRY: "0" });
    check("A8 DRY=0 without IEUM_OWNER_KEY is refused", r.code === 2 && !fs.existsSync(d.batches), r.out);
    r = cli("approve-soul.js", ["--network", "localhost", "approve", idA, "--file", soul, ...dirsA], { DRY: "0", IEUM_OWNER_KEY: KEY1 });
    check("A9 DRY=0 + owner key: signed file in batches/, item moved to approved/", r.code === 0 && fs.existsSync(path.join(d.batches, `signed-${idA}.json`)) && fs.existsSync(path.join(d.approved, `${idA}.json`)) && pendingIds().length === 0, r.out);
    check("A10 after approve (not anchored yet): watch exit 0, check-soul exit 1", watchCli().code === 0 && checkCli(true).code === 1);

    // anchor with the existing anchorBatch flow (same calls as scripts/demo-batch.js: lib/merkle tree -> anchorBatch -> verifyBatchEntry)
    const f = path.join(d.batches, `signed-${idA}.json`);
    const s = JSON.parse(fs.readFileSync(f, "utf8"));
    const entry = { ...s.entry, signedAt: BigInt(s.entry.signedAt) };
    const domain = { name: "SoulRegistry", version: "1", chainId: (await provider.getNetwork()).chainId, verifyingContract: addr };
    const { root, proofs } = buildTree([entryLeaf(domain, entry, s.signature)]);
    const regAdmin = new ethers.Contract(addr, art.abi, deployer);
    await (await regAdmin.anchorBatch(root, 1)).wait();
    check("A11 on-chain verifyBatchEntry is true for the signed entry", await regAdmin.verifyBatchEntry(entry, s.signature, proofs[0], root));
    fs.writeFileSync(f, JSON.stringify({ ...s, root, proof: proofs[0] }, null, 2));
    r = checkCli(true);
    check("A12 anchored: check-soul --batches-dir exit 0", r.code === 0, r.out);
    check("A13 anchored: watch exit 0", watchCli().code === 0);
    check("A14 signed file carries no SOUL text", !/SECRET-MARKER|alpha|beta/.test(fs.readFileSync(f, "utf8")));

    // ---- Flow B: reject ----
    const v3 = v2 + "SECRET-MARKER-B secretly changed\n";
    fs.writeFileSync(soul, v3);
    r = watchCli();
    check("B1 second change: watch exit 1, item records diffLines=1", r.code === 1 && pendingIds().length === 1 && JSON.parse(fs.readFileSync(path.join(d.pending, `${pendingIds()[0]}.json`), "utf8")).diffLines === 1, r.out);
    const idB = pendingIds()[0];
    const batchesBefore = fs.readdirSync(d.batches).length;
    r = cli("approve-soul.js", ["reject", idB, "--reason", "I did not edit this", ...dirsA]);
    const rej = fs.existsSync(path.join(d.rejected, `${idB}.json`)) ? JSON.parse(fs.readFileSync(path.join(d.rejected, `${idB}.json`), "utf8")) : {};
    check("B2 reject: item in rejected/ marked 몰래 바뀜 의심, pending empty, nothing signed", r.code === 0 && rej.flag === "suspected-tampering" && rej.label === "몰래 바뀜 의심" && pendingIds().length === 0 && fs.readdirSync(d.batches).length === batchesBefore, r.out);
    check("B3 watch does not re-create a rejected fingerprint (exit 3)", watchCli().code === 3 && pendingIds().length === 0);
    check("B4 check-soul still exit 1 (tampered file is NOT recorded)", checkCli(true).code === 1);
    r = cli("approve-soul.js", ["--network", "localhost", "approve", idB, "--file", soul, ...dirsA], { DRY: "0", IEUM_OWNER_KEY: KEY1 });
    check("B5 a rejected item can no longer be approved", r.code === 2, r.out);
  } finally {
    node.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
