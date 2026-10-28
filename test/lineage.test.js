const { expect } = require("chai");
const { parseFork, forkMarker, buildTree, collectIds } = require("../register/lineage");

describe("lineage (fork-of parser, self-reported)", function () {
  describe("parseFork", function () {
    it("parses the canonical marker", function () {
      expect(parseFork("fork-of:7@v2")).to.deep.equal({ agentId: "7", version: 2 });
    });
    it("finds it inside a longer note, after separators", function () {
      expect(parseFork("branch for tests; fork-of:12@v10")).to.deep.equal({ agentId: "12", version: 10 });
      expect(parseFork("x (fork-of:3@v1)")).to.deep.equal({ agentId: "3", version: 1 });
      expect(parseFork("a|fork-of:3@v1|b")).to.deep.equal({ agentId: "3", version: 1 });
    });
    it("checks note first, then metaURI; skips non-strings", function () {
      expect(parseFork("plain", "ipfs://x fork-of:4@v3")).to.deep.equal({ agentId: "4", version: 3 });
      expect(parseFork("fork-of:1@v1", "fork-of:2@v2")).to.deep.equal({ agentId: "1", version: 1 });
      expect(parseFork(undefined, null, "fork-of:9@v9")).to.deep.equal({ agentId: "9", version: 9 });
    });
    it("rejects malformed markers", function () {
      for (const s of ["", "fork-of:@v1", "fork-of:1@v0", "fork-of:0@v1", "fork-of:01@v1", "fork-of:1@v01", "fork-of:1@2", "fork-of:1:v2",
        "Fork-Of:1@v2", "xfork-of:1@v2", "fork-of:1@v2x", "fork-of:1@v2@v3", "fork-of:-1@v2", "fork-of:1@v1234567", "fork-of:1.5@v1", "fork-of:0x10@v1"]) {
        expect(parseFork(s), s).to.equal(null);
      }
    });
    it("does not overflow on huge ids (bounded length)", function () {
      expect(parseFork("fork-of:" + "9".repeat(30) + "@v1")).to.equal(null);
    });
    it("forkMarker round-trips", function () {
      expect(parseFork(forkMarker(5n, 3))).to.deep.equal({ agentId: "5", version: 3 });
    });
  });

  describe("buildTree", function () {
    const A = { id: 1n, name: "A", note: "origin", metaURI: "", recordCount: 3 };
    const B = { id: 2n, name: "B", note: "fork-of:1@v2", metaURI: "", recordCount: 1 };
    const C = { id: 3n, name: "C", note: "x", metaURI: "fork-of:1@v2", recordCount: 2 };
    const D = { id: 4n, name: "D", note: "fork-of:2@v1", metaURI: "", recordCount: 1 };

    it("attaches forks to the claimed version (note and metaURI), ordered by id", function () {
      const t = buildTree(1, [A, B, C]);
      expect(Object.keys(t.branches)).to.deep.equal(["2"]);
      expect(t.branches[2].map((s) => s.id)).to.deep.equal(["2", "3"]);
      expect(t.parent).to.equal(null);
    });
    it("recurses (fork of a fork) and reports the root's own parent claim", function () {
      const t = buildTree(1, [A, B, D]);
      expect(t.branches[2][0].branches[1][0].id).to.equal("4");
      const tb = buildTree(2, [A, B, D]);
      expect(tb.parent).to.deep.equal({ agentId: "1", version: 2, exists: true, name: "A" });
      expect(collectIds(t)).to.deep.equal(["1", "2", "4"]);
    });
    it("claims at a version the parent does not have are dangling, not branches", function () {
      const bad = { id: 5n, name: "E", note: "fork-of:1@v9", metaURI: "", recordCount: 1 };
      const t = buildTree(1, [A, bad]);
      expect(t.branches).to.deep.equal({});
      expect(t.dangling.map((d) => d.id)).to.deep.equal(["5"]);
      expect(buildTree(5, [A, bad]).parent.exists).to.equal(false);
    });
    it("a claim naming an unknown agent is kept but not existing", function () {
      const orphan = { id: 6n, name: "F", note: "fork-of:99@v1", metaURI: "", recordCount: 1 };
      expect(buildTree(6, [A, orphan]).parent).to.deep.equal({ agentId: "99", version: 1, exists: false, name: null });
    });
    it("ignores self-forks and survives cycles", function () {
      const s = { id: 7n, name: "S", note: "fork-of:7@v1", metaURI: "", recordCount: 1 };
      expect(buildTree(7, [s]).forkFrom).to.equal(null);
      const x = { id: 8n, name: "X", note: "fork-of:9@v1", metaURI: "", recordCount: 1 };
      const y = { id: 9n, name: "Y", note: "fork-of:8@v1", metaURI: "", recordCount: 1 };
      const t = buildTree(8, [x, y]);
      expect(collectIds(t).length).to.be.lessThan(10);
    });
    it("caps depth", function () {
      const chain = [];
      for (let i = 1; i <= 10; i++) chain.push({ id: i, name: "n" + i, note: i === 1 ? "" : `fork-of:${i - 1}@v1`, metaURI: "", recordCount: 1 });
      expect(collectIds(buildTree(1, chain, { maxDepth: 3 }))).to.deep.equal(["1", "2", "3", "4"]);
    });
    it("unknown root yields an empty node", function () {
      const t = buildTree(42, [A]);
      expect(t.agent).to.equal(null);
      expect(t.branches).to.deep.equal({});
    });
  });
});
