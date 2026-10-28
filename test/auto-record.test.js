// Unit tests for auto-record: lib/soul-baseline.js, scripts/watch-soul.js, scripts/approve-soul.js, check-soul.js --batches-dir.
// All SOUL text is SYNTHETIC. The owner key is hardhat's public default test key #1 (never a real key).
const { expect } = require("chai");
const { ethers } = require("hardhat");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const B = require("../lib/soul-baseline");
const { buildTree, entryLeaf, domainOf } = require("../lib/merkle");
const watch = require("../scripts/watch-soul");
const approve = require("../scripts/approve-soul");
const check = require("../scripts/check-soul");

const KEY1 = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const sha = (b) => "0x" + crypto.createHash("sha256").update(b).digest("hex");

describe("auto-record (watch -> approve -> anchor -> check)", function () {
  let reg, admin, dir, d, logs, log, soulFile;
  const v1 = "# Synthetic SOUL\nline one\nline two\n";
  const v2 = v1 + "SECRET-MARKER-LINE added\n";
  const dirsArgs = () => ["--pending-dir", d.pending, "--rejected-dir", d.rejected, "--batches-dir", d.batches, "--state-dir", d.state, "--approved-dir", d.approved];
  const W = () => watch.run(["--agent", "1", soulFile, "--pending-dir", d.pending, "--rejected-dir", d.rejected, "--batches-dir", d.batches, "--state-dir", d.state], { registry: reg, log });
  const A = (args, env = {}) => approve.run([...args, ...dirsArgs()], { registry: reg, log, env });
  const pendingFiles = () => (fs.existsSync(d.pending) ? fs.readdirSync(d.pending) : []);

  beforeEach(async function () {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "auto-record-"));
    d = Object.fromEntries(["pending", "rejected", "batches", "state", "approved"].map((k) => [k, path.join(dir, k)]));
    logs = []; log = (s) => logs.push(s);
    let alice;
    [admin, alice] = await ethers.getSigners();
    const c = await ethers.deployContract("SoulRegistry");
    reg = c.connect(alice);
    await reg.registerAgent("Synthetic-Auto", "test", "");
    await reg.appendSoul(1, sha(Buffer.from(v1)), ethers.ZeroHash, "v1");
    soulFile = path.join(dir, "SOUL.md");
    fs.writeFileSync(soulFile, v1);
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("lib: lineHashes/diffLineCount count added+removed lines, CRLF-insensitive", function () {
    const a = B.lineHashes(Buffer.from("a\r\nb\r\nc\r\n"));
    expect(a).to.deep.equal(B.lineHashes(Buffer.from("a\nb\nc\n")));
    expect(B.diffLineCount(a, B.lineHashes(Buffer.from("a\nb\nc\nd\n")))).to.equal(1);
    expect(B.diffLineCount(a, B.lineHashes(Buffer.from("a\nX\nc\n")))).to.equal(2);
    expect(B.diffLineCount(a, a)).to.equal(0);
  });

  it("lib: mergeSigned follows parentHash only (a signed entry the ledger moved past is ignored)", function () {
    const e = (h, p) => ({ entry: { soulHash: h, parentHash: p } });
    const c = { hist: ["0xa", "0xb"] };
    expect(B.mergeSigned(c, [e("0xc", "0xb"), e("0xd", "0xc")]).hist).to.deep.equal(["0xa", "0xb", "0xc", "0xd"]);
    expect(B.mergeSigned(c, [e("0xz", "0xa")]).hist).to.deep.equal(["0xa", "0xb"]);
  });

  it("watch: exit 0 and no pending item when the file equals the latest version", async function () {
    expect(await W()).to.equal(0);
    expect(pendingFiles()).to.have.length(0);
  });

  it("watch: changed file -> exit 1, one pending item with fingerprint metadata only (no content)", async function () {
    fs.writeFileSync(soulFile, v2);
    expect(await W()).to.equal(1);
    const files = pendingFiles();
    expect(files).to.have.length(1);
    const raw = fs.readFileSync(path.join(d.pending, files[0]), "utf8");
    const item = JSON.parse(raw);
    expect(Object.keys(item).sort()).to.deep.equal(["agentId", "agentName", "detectedAt", "diffLines", "id", "kind", "parentHash", "prevVersion", "soulHash", "status"]);
    expect(item.soulHash).to.equal(sha(Buffer.from(v2)));
    expect(item.parentHash).to.equal(sha(Buffer.from(v1)));
    expect(item.prevVersion).to.equal(1);
    expect(item.diffLines).to.equal(null); // no baseline state yet
    expect(raw).to.not.contain("SECRET-MARKER").and.not.contain("line one");
  });

  it("watch: same fingerprint again -> exit 3, no duplicate; a different change is a new item", async function () {
    fs.writeFileSync(soulFile, v2);
    await W();
    expect(await W()).to.equal(3);
    expect(pendingFiles()).to.have.length(1);
    fs.writeFileSync(soulFile, v2 + "more\n");
    expect(await W()).to.equal(1);
    expect(pendingFiles()).to.have.length(2);
  });

  it("watch: bad inputs -> exit 2 (missing file, no agent arg, unknown agent, empty history)", async function () {
    expect(await watch.run(["--agent", "1", path.join(dir, "nope.md")], { registry: reg, log })).to.equal(2);
    expect(await watch.run([soulFile], { registry: reg, log })).to.equal(2);
    expect(await watch.run(["--agent", "9", soulFile], { registry: reg, log })).to.equal(2);
    await reg.registerAgent("Empty", "x", "");
    expect(await watch.run(["--agent", "2", soulFile], { registry: reg, log })).to.equal(2);
  });

  it("approve: DRY is the default - prints the entry, signs and writes nothing", async function () {
    fs.writeFileSync(soulFile, v2);
    await W();
    const id = JSON.parse(fs.readFileSync(path.join(d.pending, pendingFiles()[0]), "utf8")).id;
    expect(await A(["approve", id, "--file", soulFile])).to.equal(0);
    expect(logs.join("\n")).to.match(/DRY RUN/);
    expect(fs.existsSync(d.batches)).to.equal(false);
    expect(pendingFiles()).to.have.length(1);
  });

  it("approve: DRY=0 refuses without key, with a non-owner key, and when the file changed after detection", async function () {
    fs.writeFileSync(soulFile, v2);
    await W();
    const id = JSON.parse(fs.readFileSync(path.join(d.pending, pendingFiles()[0]), "utf8")).id;
    expect(await A(["approve", id, "--file", soulFile], { DRY: "0" })).to.equal(2);
    expect(logs.join("\n")).to.match(/IEUM_OWNER_KEY/);
    const stranger = ethers.Wallet.createRandom().privateKey;
    expect(await A(["approve", id, "--file", soulFile], { DRY: "0", IEUM_OWNER_KEY: stranger })).to.equal(2);
    expect(logs.join("\n")).to.match(/not the owner/);
    fs.writeFileSync(soulFile, v2 + "swapped after detection\n");
    expect(await A(["approve", id, "--file", soulFile], { DRY: "0", IEUM_OWNER_KEY: KEY1 })).to.equal(2);
    expect(logs.join("\n")).to.match(/changed again/);
    expect(fs.existsSync(d.batches)).to.equal(false);
    expect(pendingFiles()).to.have.length(1);
  });

  it("approve DRY=0: signs EIP-712, moves item to approved/, then watch is quiet (signed entry is the new baseline) and diffLines is known next time", async function () {
    fs.writeFileSync(soulFile, v2);
    await W();
    const id = JSON.parse(fs.readFileSync(path.join(d.pending, pendingFiles()[0]), "utf8")).id;
    expect(await A(["approve", id, "--file", soulFile], { DRY: "0", IEUM_OWNER_KEY: KEY1 })).to.equal(0);
    expect(pendingFiles()).to.have.length(0);
    expect(fs.existsSync(path.join(d.approved, `${id}.json`))).to.equal(true);
    const signed = JSON.parse(fs.readFileSync(path.join(d.batches, `signed-${id}.json`), "utf8"));
    expect(signed.entry.note).to.equal(approve.NOTE);
    expect(signed.entry.soulHash).to.equal(sha(Buffer.from(v2)));
    expect(await W()).to.equal(0); // approved-but-unanchored counts as latest for watch
    fs.writeFileSync(soulFile, v2 + "x1\nx2\n");
    expect(await W()).to.equal(1);
    const next = JSON.parse(fs.readFileSync(path.join(d.pending, pendingFiles()[0]), "utf8"));
    expect(next.diffLines).to.equal(2);
    expect(next.prevVersion).to.equal(2);
  });

  it("approve -> anchor -> check-soul: exit 1 before anchoring, exit 0 after (verifyBatchEntry on-chain)", async function () {
    fs.writeFileSync(soulFile, v2);
    await W();
    const id = JSON.parse(fs.readFileSync(path.join(d.pending, pendingFiles()[0]), "utf8")).id;
    await A(["approve", id, "--file", soulFile], { DRY: "0", IEUM_OWNER_KEY: KEY1 });
    const args = ["--agent", "1", soulFile, "--batches-dir", d.batches];
    expect(await check.run(args, { registry: reg, log })).to.equal(1); // signed but not anchored

    const f = path.join(d.batches, `signed-${id}.json`);
    const s = JSON.parse(fs.readFileSync(f, "utf8"));
    const entry = { ...s.entry, signedAt: BigInt(s.entry.signedAt) };
    const domain = await domainOf(reg);
    const { root, proofs } = buildTree([entryLeaf(domain, entry, s.signature)]);
    await (await reg.connect(admin).anchorBatch(root, 1)).wait();
    fs.writeFileSync(f, JSON.stringify({ ...s, root, proof: proofs[0] }, null, 2));
    expect(await check.run(args, { registry: reg, log })).to.equal(0);
    expect(await check.run(["--agent", "1", soulFile], { registry: reg, log })).to.equal(1); // without --batches-dir only the ledger counts

    s.entry.note = "tampered"; // tampered signed file must not verify
    fs.writeFileSync(f, JSON.stringify({ ...s, root, proof: proofs[0] }, null, 2));
    expect(await check.run(args, { registry: reg, log })).to.equal(1);
  });

  it("reject: moves the item to rejected/ flagged suspected-tampering, signs nothing, and watch does not re-create it (exit 3)", async function () {
    fs.writeFileSync(soulFile, v2);
    await W();
    const id = JSON.parse(fs.readFileSync(path.join(d.pending, pendingFiles()[0]), "utf8")).id;
    expect(await A(["reject", id, "--reason", "did not edit"])).to.equal(0);
    expect(pendingFiles()).to.have.length(0);
    const r = JSON.parse(fs.readFileSync(path.join(d.rejected, `${id}.json`), "utf8"));
    expect(r.status).to.equal("rejected");
    expect(r.flag).to.equal("suspected-tampering");
    expect(r.label).to.equal("몰래 바뀜 의심");
    expect(r.reason).to.equal("did not edit");
    expect(fs.existsSync(d.batches)).to.equal(false);
    expect(await W()).to.equal(3);
    expect(pendingFiles()).to.have.length(0);
  });

  it("approve/reject: bad ids and unknown items -> exit 2", async function () {
    expect(await A(["approve", "../evil", "--file", soulFile])).to.equal(2);
    expect(await A(["reject", "a1-deadbeef"])).to.equal(2);
    expect(await A(["approve", "a1-deadbeef"])).to.equal(2);
  });
});
