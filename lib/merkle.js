// Minimal sorted-pair keccak Merkle tree matching SoulRegistry.processProof.
const { ethers } = require("ethers");

function hashPair(a, b) {
  const [x, y] = BigInt(a) < BigInt(b) ? [a, b] : [b, a];
  return ethers.keccak256(ethers.concat([x, y]));
}

// Returns { root, proofs: [bytes32[] per leaf] }. An odd node is carried up unchanged.
function buildTree(leaves) {
  if (leaves.length === 0) throw new Error("empty tree");
  const layers = [leaves.slice()];
  while (layers[layers.length - 1].length > 1) {
    const prev = layers[layers.length - 1];
    const next = [];
    for (let i = 0; i < prev.length; i += 2) {
      next.push(i + 1 < prev.length ? hashPair(prev[i], prev[i + 1]) : prev[i]);
    }
    layers.push(next);
  }
  const proofs = leaves.map((_, leafIndex) => {
    const proof = [];
    let idx = leafIndex;
    for (let l = 0; l < layers.length - 1; l++) {
      const sib = idx ^ 1;
      if (sib < layers[l].length) proof.push(layers[l][sib]);
      idx >>= 1;
    }
    return proof;
  });
  return { root: layers[layers.length - 1][0], proofs };
}

const SOUL_ENTRY_TYPES = {
  SoulEntry: [
    { name: "owner", type: "address" },
    { name: "agentName", type: "string" },
    { name: "soulHash", type: "bytes32" },
    { name: "parentHash", type: "bytes32" },
    { name: "note", type: "string" },
    { name: "signedAt", type: "uint64" },
  ],
};

async function domainOf(registry) {
  const net = await registry.runner.provider.getNetwork();
  return { name: "SoulRegistry", version: "1", chainId: net.chainId, verifyingContract: await registry.getAddress() };
}

// Same formula as SoulRegistry.entryLeaf: keccak(keccak(abi.encode(digest, keccak(signature))))
function entryLeaf(domain, entry, signature) {
  const digest = ethers.TypedDataEncoder.hash(domain, SOUL_ENTRY_TYPES, entry);
  const inner = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(["bytes32", "bytes32"], [digest, ethers.keccak256(signature)])
  );
  return ethers.keccak256(inner);
}

module.exports = { hashPair, buildTree, SOUL_ENTRY_TYPES, domainOf, entryLeaf };
