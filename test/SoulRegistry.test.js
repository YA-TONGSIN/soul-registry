const { expect } = require("chai");
const { ethers } = require("hardhat");
const { buildTree, SOUL_ENTRY_TYPES, domainOf, entryLeaf } = require("../lib/merkle");

const ZERO = ethers.ZeroHash;
const h = (s) => ethers.sha256(ethers.toUtf8Bytes(s));

describe("SoulRegistry", function () {
  let reg, admin, alice, bob;

  beforeEach(async function () {
    [admin, alice, bob] = await ethers.getSigners();
    reg = await ethers.deployContract("SoulRegistry");
  });

  describe("registration", function () {
    it("registers an agent with sequential id and emits AgentRegistered", async function () {
      await expect(reg.connect(alice).registerAgent("Ieum", "test agent", ""))
        .to.emit(reg, "AgentRegistered")
        .withArgs(1n, alice.address, "Ieum", "test agent", "");
      await reg.connect(bob).registerAgent("Other", "", "ipfs://x");
      const a = await reg.getAgent(1);
      expect(a.name).to.equal("Ieum");
      expect(a.note).to.equal("test agent");
      expect(a.owner).to.equal(alice.address);
      expect(a.headHash).to.equal(ZERO);
      expect((await reg.getAgent(2)).metaURI).to.equal("ipfs://x");
      expect(await reg.agentCount()).to.equal(2n);
    });

    it("rejects empty or too-long names and unknown agents", async function () {
      await expect(reg.registerAgent("", "", "")).to.be.revertedWithCustomError(reg, "EmptyName");
      await expect(reg.registerAgent("x".repeat(65), "", "")).to.be.revertedWithCustomError(reg, "TooLong");
      await expect(reg.getAgent(9)).to.be.revertedWithCustomError(reg, "UnknownAgent");
    });
  });

  describe("history", function () {
    beforeEach(async function () {
      await reg.connect(alice).registerAgent("Ieum", "test agent", "");
    });

    it("only the owner can append", async function () {
      await expect(reg.connect(bob).appendSoul(1, h("v1"), ZERO, "x")).to.be.revertedWithCustomError(
        reg,
        "NotAgentOwner"
      );
      await expect(reg.connect(alice).appendSoul(7, h("v1"), ZERO, "x")).to.be.revertedWithCustomError(
        reg,
        "UnknownAgent"
      );
    });

    it("links parentHash into a chain and emits SoulAppended", async function () {
      const [v1, v2, v3] = [h("v1"), h("v2"), h("v3")];
      await expect(reg.connect(alice).appendSoul(1, v1, ZERO, "first"))
        .to.emit(reg, "SoulAppended")
        .withArgs(1n, v1, ZERO, 0, "first");
      await reg.connect(alice).appendSoul(1, v2, v1, "second");
      await reg.connect(alice).appendSoul(1, v3, v2, "third");
      const hist = await reg.getHistory(1);
      expect(hist.map((r) => r.soulHash)).to.deep.equal([v1, v2, v3]);
      expect(hist.map((r) => r.parentHash)).to.deep.equal([ZERO, v1, v2]);
      expect((await reg.getAgent(1)).headHash).to.equal(v3);
      expect(await reg.verifyChain(1)).to.equal(true);
    });

    it("rejects a wrong parent, a zero hash, duplicates and long notes", async function () {
      const [v1, v2] = [h("v1"), h("v2")];
      await expect(reg.connect(alice).appendSoul(1, v1, v2, ""))
        .to.be.revertedWithCustomError(reg, "BadParent")
        .withArgs(ZERO, v2);
      await reg.connect(alice).appendSoul(1, v1, ZERO, "");
      await expect(reg.connect(alice).appendSoul(1, v2, ZERO, "")).to.be.revertedWithCustomError(reg, "BadParent");
      await expect(reg.connect(alice).appendSoul(1, ZERO, v1, "")).to.be.revertedWithCustomError(reg, "ZeroHash");
      await expect(reg.connect(alice).appendSoul(1, v1, v1, "")).to.be.revertedWithCustomError(reg, "DuplicateSoul");
      await expect(reg.connect(alice).appendSoul(1, v2, v1, "n".repeat(161))).to.be.revertedWithCustomError(
        reg,
        "TooLong"
      );
    });

    it("records carry-over scores only for known SOUL versions", async function () {
      const v1 = h("v1");
      await reg.connect(alice).appendSoul(1, v1, ZERO, "");
      await expect(reg.connect(alice).recordCarryOver(1, h("nope"), "a", "b", h("r"), 9000)).to.be.revertedWithCustomError(
        reg,
        "UnknownSoul"
      );
      await expect(reg.connect(alice).recordCarryOver(1, v1, "a", "b", h("r"), 10001)).to.be.revertedWithCustomError(
        reg,
        "ScoreOutOfRange"
      );
      await expect(reg.connect(alice).recordCarryOver(1, v1, "model-a", "model-b", h("r"), 8750))
        .to.emit(reg, "CarryOverRecorded")
        .withArgs(1n, v1, "model-a", "model-b", h("r"), 8750);
      expect((await reg.getScores(1))[0].scoreBps).to.equal(8750n);
    });

    it("transfers ownership; old owner loses rights", async function () {
      await expect(reg.connect(alice).transferAgent(1, bob.address))
        .to.emit(reg, "AgentTransferred")
        .withArgs(1n, alice.address, bob.address);
      await expect(reg.connect(alice).appendSoul(1, h("v1"), ZERO, "")).to.be.revertedWithCustomError(
        reg,
        "NotAgentOwner"
      );
      await reg.connect(bob).appendSoul(1, h("v1"), ZERO, "");
      await expect(reg.connect(bob).setMetaURI(1, "https://e.x/a.json"))
        .to.emit(reg, "MetaURIUpdated")
        .withArgs(1n, "https://e.x/a.json");
    });
  });

  describe("batches", function () {
    async function signedEntries(signers) {
      const domain = await domainOf(reg);
      const out = [];
      for (const [i, s] of signers.entries()) {
        const entry = {
          owner: s.address,
          agentName: `Demo-${i}`,
          soulHash: h(`soul-${i}`),
          parentHash: ZERO,
          note: `demo entry ${i}`,
          signedAt: 1761350400n + BigInt(i),
        };
        const signature = await s.signTypedData(domain, SOUL_ENTRY_TYPES, entry);
        out.push({ entry, signature, leaf: entryLeaf(domain, entry, signature) });
      }
      return out;
    }

    it("contract leaf/digest match the off-chain computation", async function () {
      const [e] = await signedEntries([alice]);
      expect(await reg.entryLeaf(e.entry, e.signature)).to.equal(e.leaf);
    });

    it("anchors a root (anchorer only) and verifies Merkle proofs", async function () {
      const entries = await signedEntries([alice, bob, admin]); // 3 leaves -> odd node path
      const { root, proofs } = buildTree(entries.map((e) => e.leaf));

      await expect(reg.connect(alice).anchorBatch(root, 3)).to.be.revertedWithCustomError(reg, "NotAnchorer");
      expect(await reg.verifyInBatch(entries[0].leaf, proofs[0], root)).to.equal(false); // not anchored yet

      await expect(reg.anchorBatch(root, 3)).to.emit(reg, "BatchAnchored").withArgs(0n, root, 3, admin.address);
      await expect(reg.anchorBatch(root, 3)).to.be.revertedWithCustomError(reg, "RootAlreadyAnchored");
      await expect(reg.anchorBatch(ZERO, 3)).to.be.revertedWithCustomError(reg, "ZeroHash");
      await expect(reg.anchorBatch(h("r2"), 0)).to.be.revertedWithCustomError(reg, "EmptyBatch");

      for (let i = 0; i < entries.length; i++) {
        expect(await reg.verifyInBatch(entries[i].leaf, proofs[i], root)).to.equal(true);
        expect(await reg.verifyBatchEntry(entries[i].entry, entries[i].signature, proofs[i], root)).to.equal(true);
      }
      // wrong proof / wrong leaf
      expect(await reg.verifyInBatch(entries[0].leaf, proofs[1], root)).to.equal(false);
      expect(await reg.verifyInBatch(h("fake"), proofs[0], root)).to.equal(false);
      const b = await reg.getBatch(0);
      expect(b.count).to.equal(3n);
      expect(await reg.batchCount()).to.equal(1n);
    });

    it("rejects a tampered entry or a signature by someone else", async function () {
      const entries = await signedEntries([alice, bob]);
      const { root, proofs } = buildTree(entries.map((e) => e.leaf));
      await reg.anchorBatch(root, 2);
      const tampered = { ...entries[0].entry, note: "changed" };
      expect(await reg.verifyBatchEntry(tampered, entries[0].signature, proofs[0], root)).to.equal(false);
      const forged = { ...entries[0].entry, owner: bob.address };
      expect(await reg.verifyBatchEntry(forged, entries[0].signature, proofs[0], root)).to.equal(false);
    });

    it("admin can add/remove anchorers", async function () {
      await expect(reg.connect(alice).setAnchorer(alice.address, true)).to.be.revertedWithCustomError(reg, "NotAdmin");
      await expect(reg.setAnchorer(alice.address, true)).to.emit(reg, "AnchorerSet").withArgs(alice.address, true);
      await reg.connect(alice).anchorBatch(h("root"), 1);
      await reg.setAnchorer(alice.address, false);
      await expect(reg.connect(alice).anchorBatch(h("root2"), 1)).to.be.revertedWithCustomError(reg, "NotAnchorer");
    });
  });
});
