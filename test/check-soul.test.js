const { expect } = require("chai");
const { ethers } = require("hardhat");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { normalizeLF, sha256Hex, compare, splitSpec, run } = require("../scripts/check-soul");

const sha = (b) => "0x" + crypto.createHash("sha256").update(b).digest("hex");

describe("check-soul (tamper check)", function () {
  let reg, dir, logs, log;
  const v1 = "# Synthetic SOUL\nline one\nline two\n";
  const v2 = v1 + "added line\n";
  const write = (name, text) => { const p = path.join(dir, name); fs.writeFileSync(p, text); return p; };

  beforeEach(async function () {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "check-soul-"));
    logs = []; log = (s) => logs.push(s);
    const [, alice] = await ethers.getSigners();
    reg = (await ethers.deployContract("SoulRegistry")).connect(alice);
    await reg.registerAgent("Synthetic", "test", "");
    await reg.appendSoul(1, sha(Buffer.from(v1)), ethers.ZeroHash, "v1");
    await reg.appendSoul(1, sha(Buffer.from(v2)), sha(Buffer.from(v1)), "v2");
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("normalizes CRLF and lone CR to LF", function () {
    expect(normalizeLF(Buffer.from("a\r\nb\rc\n")).toString()).to.equal("a\nb\nc\n");
    expect(sha256Hex(Buffer.from("abc"))).to.equal("0xba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("exit 0 when file equals latest version (CRLF copy still matches via LF)", async function () {
    const f = write("SOUL.md", v2.replace(/\n/g, "\r\n"));
    expect(await run(["--agent", "1", f], { registry: reg, log })).to.equal(0);
    expect(logs.join("\n")).to.match(/OK .*latest v2/);
  });

  it("exit 1 and names the older version when file is stale", async function () {
    const f = write("SOUL.md", v1);
    expect(await run(["--agent", "1", f], { registry: reg, log })).to.equal(1);
    expect(logs.join("\n")).to.match(/OLDER v1, latest is v2/);
  });

  it("exit 1 when a single byte was changed", async function () {
    const f = write("SOUL.md", v2.replace("one", "ONE"));
    expect(await run(["--agent", "1", f], { registry: reg, log })).to.equal(1);
    expect(logs.join("\n")).to.match(/NO recorded version/);
  });

  it("exit 2 for missing file, unknown agent, bad args; 2 beats 1", async function () {
    expect(await run(["--agent", "1", path.join(dir, "nope.md")], { registry: reg, log })).to.equal(2);
    const f = write("SOUL.md", v2);
    expect(await run(["--agent", "99", f], { registry: reg, log })).to.equal(2);
    expect(await run([f], { registry: reg, log })).to.equal(2); // no agent id
    expect(await run(["--bogus", f], { registry: reg, log })).to.equal(2);
    const stale = write("OLD.md", v1);
    expect(await run(["--agent", "1", stale, path.join(dir, "nope.md")], { registry: reg, log })).to.equal(2);
  });

  it("supports per-file agent ids and --json output", async function () {
    const f = write("SOUL.md", v2);
    expect(await run([`${f}@1`, "--json"], { registry: reg, log })).to.equal(0);
    const j = JSON.parse(logs.join("\n"));
    expect(j.exitCode).to.equal(0);
    expect(j.results[0]).to.include({ status: "match", version: 2, headVersion: 2 });
  });

  it("splitSpec only treats a trailing @digits as agent id", function () {
    expect(splitSpec("C:\\a@b\\SOUL.md@3")).to.deep.equal({ file: "C:\\a@b\\SOUL.md", agentId: 3n });
    expect(() => splitSpec("SOUL.md")).to.throw();
  });

  it("compare() reports raw-byte matches (legacy CRLF-hashed versions)", function () {
    const crlf = Buffer.from("x\r\ny\r\n");
    const r = compare(crlf, { hist: [sha(crlf)], head: sha(crlf) });
    expect(r).to.include({ status: "match", via: "raw", version: 1 });
  });
});
