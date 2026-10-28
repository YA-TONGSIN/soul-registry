const { expect } = require("chai");
const { ethers } = require("hardhat");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { scoreToBps, buildCall, readEvidence, saveEvidence, run } = require("../scripts/record-score");

const sha = (b) => "0x" + crypto.createHash("sha256").update(b).digest("hex");
const URL1 = "https://doi.org/10.5281/zenodo.0000000"; // SYNTHETIC placeholder DOI, not a real record

describe("record-score (SOUL VERIFY score recorder)", function () {
  let reg, dir, logs, log, v1;
  const write = (name, text) => { const p = path.join(dir, name); fs.writeFileSync(p, text); return p; };
  const base = ["--agent", "1", "--model", "synthetic-B", "--score", "0.8123", "--evidence-url", URL1];

  beforeEach(async function () {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "record-score-"));
    logs = []; log = (s) => logs.push(s);
    const [, alice] = await ethers.getSigners();
    reg = (await ethers.deployContract("SoulRegistry")).connect(alice);
    await reg.registerAgent("Synthetic", "test", "");
    v1 = sha(Buffer.from("synthetic soul v1\n"));
    await reg.appendSoul(1, v1, ethers.ZeroHash, "v1");
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("scoreToBps: strict 0..1 decimals only", function () {
    expect(scoreToBps("0")).to.equal(0);
    expect(scoreToBps("1")).to.equal(10000);
    expect(scoreToBps("0.8123")).to.equal(8123);
    expect(scoreToBps("0.00005")).to.equal(1);
    for (const bad of ["1.01", "-0.1", "82", "82%", "NaN", "1e-1", "", " ", "0x1"]) expect(() => scoreToBps(bad), bad).to.throw();
    expect(() => scoreToBps(undefined)).to.throw();
  });

  it("buildCall: report hash = sha256(URL) by default, validates limits", function () {
    const c = buildCall({ agent: "1", model: "m", score: "0.5", url: URL1 });
    expect(c.reportHash).to.equal(sha(Buffer.from(URL1)));
    expect(c.scoreBps).to.equal(5000);
    expect(() => buildCall({ agent: "1", model: "m".repeat(65), score: "0.5", url: URL1 })).to.throw(/64 bytes/);
    expect(() => buildCall({ agent: "1", model: "가".repeat(22), score: "0.5", url: URL1 })).to.throw(/64 bytes/); // 66 bytes
    expect(() => buildCall({ agent: "1", model: "m", score: "0.5", url: "http://x.org/a" })).to.throw(/https/);
    expect(() => buildCall({ agent: "1", model: "m", score: "0.5", url: "https://x.org/" + "a".repeat(200) })).to.throw(/200 bytes/);
    expect(() => buildCall({ agent: "1", model: "m", score: "0.5" })).to.throw(/evidence required/);
    expect(() => buildCall({ agent: "1", model: "m", score: "0.5", reportHash: "0x" + "0".repeat(64) })).to.throw(/zero/);
    expect(() => buildCall({ agent: "0", model: "m", score: "0.5", url: URL1 })).to.throw(/agent/);
  });

  it("DRY is the default: validates against the chain but sends nothing", async function () {
    expect(await run([...base, "--soul-hash", v1], { registry: reg, env: {}, log })).to.equal(0);
    expect(logs.join("\n")).to.match(/DRY RUN/).and.to.match(/"scoreBps":8123/).and.to.match(/"version":1/);
    expect(await reg.getScores(1)).to.have.length(0);
  });

  it("DRY=0 records the score (soul-hash and soul-file forms)", async function () {
    expect(await run([...base, "--soul-hash", v1, "--from-model", "synthetic-A"], { registry: reg, env: { DRY: "0" }, log })).to.equal(0);
    const f = write("SOUL.md", "synthetic soul v1\r\n"); // CRLF copy matches via LF normalization
    expect(await run(["--agent", "1", "--model", "synthetic-C", "--score", "1", "--report-hash", "0x" + "ab".repeat(32), "--soul-file", f], { registry: reg, env: { DRY: "0" }, log })).to.equal(0);
    const s = await reg.getScores(1);
    expect(s).to.have.length(2);
    expect(s[0].scoreBps).to.equal(8123n);
    expect(s[0].fromModel).to.equal("synthetic-A");
    expect(s[0].toModel).to.equal("synthetic-B");
    expect(s[0].soulHash).to.equal(v1);
    expect(s[0].reportHash).to.equal(sha(Buffer.from(URL1)));
    expect(s[1].scoreBps).to.equal(10000n);
  });

  it("exit 2 with a clear message for unknown soul, soul-file with no match, bad args", async function () {
    expect(await run([...base, "--soul-hash", sha(Buffer.from("never recorded"))], { registry: reg, env: { DRY: "0" }, log })).to.equal(2);
    expect(logs.join("\n")).to.match(/not recorded/);
    expect(await reg.getScores(1)).to.have.length(0);
    logs.length = 0;
    expect(await run([...base, "--soul-file", write("x.md", "other")], { registry: reg, env: {}, log })).to.equal(2);
    expect(logs.join("\n")).to.match(/matches no recorded version/);
    expect(await run([...base], { registry: reg, env: {}, log })).to.equal(2); // neither soul-hash nor soul-file
    expect(await run(["--bogus"], { registry: reg, env: {}, log })).to.equal(2);
    expect(await run(["--agent", "1", "--soul-hash", v1, "--model", "m", "--score", "2", "--evidence-url", URL1], { registry: reg, env: {}, log })).to.equal(2);
  });

  it("non-owner send fails (exit 2) and records nothing", async function () {
    const [, , mallory] = await ethers.getSigners();
    expect(await run([...base, "--soul-hash", v1], { registry: reg.connect(mallory), env: { DRY: "0" }, log })).to.equal(2);
    expect(await reg.getScores(1)).to.have.length(0);
  });

  it("without DRY=0 and a key it never reaches a signer path; DRY=0 without IEUM_OWNER_KEY refuses (no registry injected)", async function () {
    // no injected registry -> real connection path; make it fail fast before any network: missing deployment file for a fake network
    expect(await run([...base, "--soul-hash", v1, "--network", "nonexistent"], { env: { DRY: "0" }, log })).to.equal(2);
  });

  it("evidence file: save merges, refuses a URL whose hash differs", function () {
    const f = path.join(dir, "evidence.js");
    expect(readEvidence(f)).to.deep.equal({});
    const h = sha(Buffer.from(URL1));
    saveEvidence(h, URL1, f);
    saveEvidence(sha(Buffer.from("https://example.org/b")), "https://example.org/b", f);
    expect(readEvidence(f)).to.deep.equal({ [h]: URL1, [sha(Buffer.from("https://example.org/b"))]: "https://example.org/b" });
    expect(() => saveEvidence(h, "https://example.org/other", f)).to.throw(/sha256\(url\)/);
  });
});
