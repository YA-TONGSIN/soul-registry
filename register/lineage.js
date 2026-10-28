/* Ieum Ledger · lineage (fork) helpers. No network, no DOM: pure functions, usable in the browser and in node tests.
 * A "fork" is a SELF-REPORTED claim: a new agent writes `fork-of:<agentId>@v<n>` in its note or metaURI.
 * Nothing verifies it (anyone can name any parent). The contract is unchanged: one agent's chain cannot branch.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.IEUM_LINEAGE = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  // lowercase, token-delimited, ids/versions are plain positive decimals (no leading zeros, bounded length)
  const FORK_RE = /(?:^|[\s;,|(\[])fork-of:([1-9]\d{0,17})@v([1-9]\d{0,5})(?![\w@:.-])/;

  /** First valid fork marker found in the given texts (note first, then metaURI...). null when none. */
  function parseFork(...texts) {
    for (const s of texts) {
      if (typeof s !== "string") continue;
      const m = FORK_RE.exec(s);
      if (m) return { agentId: m[1], version: Number(m[2]) };
    }
    return null;
  }

  /** The canonical text to paste into a note/metaURI. */
  function forkMarker(agentId, version) {
    return "fork-of:" + String(agentId) + "@v" + Number(version);
  }

  /**
   * Build the lineage tree around `rootId`.
   * agents: [{ id, name, note, metaURI, recordCount }]  (id as string/number/bigint)
   * Returns { id, agent, forkFrom, branches: { [version]: [subtree...] }, dangling: [{id, forkFrom}], parent }
   *  - branches only for versions that exist in the parent (1..recordCount); other claims go to `dangling`
   *  - self-forks and cycles are ignored; depth is capped
   *  - `parent` (root only): the root's own claim { agentId, version, exists } or null
   */
  function buildTree(rootId, agents, opts) {
    const maxDepth = (opts && opts.maxDepth) || 4;
    const byId = new Map();
    for (const a of agents) byId.set(String(a.id), a);
    const claims = new Map(); // agentId -> {agentId, version}
    for (const a of agents) {
      const f = parseFork(a.note, a.metaURI);
      if (f && f.agentId !== String(a.id)) claims.set(String(a.id), f);
    }
    const kids = new Map(); // parentId -> [childId...] (ascending id)
    for (const [cid, f] of claims) {
      if (!kids.has(f.agentId)) kids.set(f.agentId, []);
      kids.get(f.agentId).push(cid);
    }
    for (const list of kids.values()) list.sort((x, y) => (BigInt(x) < BigInt(y) ? -1 : 1));

    function node(id, depth, seen) {
      const agent = byId.get(id) || null;
      const n = { id, agent, forkFrom: claims.get(id) || null, branches: {}, dangling: [] };
      if (!agent || depth >= maxDepth) return n;
      for (const cid of kids.get(id) || []) {
        if (seen.has(cid)) continue; // cycle
        const f = claims.get(cid);
        const sub = node(cid, depth + 1, new Set([...seen, cid]));
        if (f.version >= 1 && f.version <= Number(agent.recordCount)) (n.branches[f.version] = n.branches[f.version] || []).push(sub);
        else n.dangling.push({ id: cid, forkFrom: f, agent: byId.get(cid) });
      }
      return n;
    }
    const rid = String(rootId);
    const tree = node(rid, 0, new Set([rid]));
    const own = claims.get(rid);
    const pa = own && byId.get(own.agentId);
    tree.parent = own ? { agentId: own.agentId, version: own.version, exists: !!pa && own.version <= Number(pa.recordCount), name: pa ? pa.name : null } : null;
    return tree;
  }

  /** All agent ids that appear in the tree (root + descendants, incl. dangling children). */
  function collectIds(tree, out) {
    out = out || [];
    out.push(tree.id);
    for (const subs of Object.values(tree.branches)) for (const s of subs) collectIds(s, out);
    return out;
  }

  return { parseFork, forkMarker, buildTree, collectIds };
});
