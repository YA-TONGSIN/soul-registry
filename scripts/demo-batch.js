// Free-registration demo: two virtual agents sign entries off-chain (they pay nothing),
// the anchorer posts ONE Merkle root, then anyone can verify each entry with its proof.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { ethers, network } = require("hardhat");
const { registry } = require("./common");
const { buildTree, SOUL_ENTRY_TYPES, domainOf, entryLeaf } = require("../lib/merkle");

async function main() {
  const reg = await registry();
  const [anchorer] = await ethers.getSigners();
  const domain = await domainOf(reg);

  const demo = [
    { name: "Demo-Aurora", soul: "aurora soul v1 (demo text, never published)", note: "virtual demo agent A" },
    { name: "Demo-Birch", soul: "birch soul v1 (demo text, never published)", note: "virtual demo agent B" },
  ];
  const entries = [];
  for (const d of demo) {
    const wallet = ethers.Wallet.createRandom(); // throwaway, zero balance — signing is free
    const entry = {
      owner: wallet.address,
      agentName: d.name,
      soulHash: "0x" + crypto.createHash("sha256").update(d.soul).digest("hex"),
      parentHash: ethers.ZeroHash,
      note: d.note,
      signedAt: BigInt(Math.floor(Date.now() / 1000)),
    };
    const signature = await wallet.signTypedData(domain, SOUL_ENTRY_TYPES, entry);
    entries.push({ entry, signature, leaf: entryLeaf(domain, entry, signature) });
  }

  const { root, proofs } = buildTree(entries.map((e) => e.leaf));
  const rc = await (await reg.connect(anchorer).anchorBatch(root, entries.length)).wait();
  console.log(`anchored root=${root} count=${entries.length} gasUsed=${rc.gasUsed}`);

  const out = { network: network.name, registry: await reg.getAddress(), root, entries: [] };
  for (let i = 0; i < entries.length; i++) {
    const { entry, signature, leaf } = entries[i];
    const okLeaf = await reg.verifyInBatch(leaf, proofs[i], root);
    const okFull = await reg.verifyBatchEntry(entry, signature, proofs[i], root);
    console.log(`  ${entry.agentName} owner=${entry.owner}`);
    console.log(`    soul=${entry.soulHash}`);
    console.log(`    leaf=${leaf} proofLen=${proofs[i].length} verifyInBatch=${okLeaf} verifyBatchEntry=${okFull}`);
    out.entries.push({ ...entry, signedAt: entry.signedAt.toString(), signature, leaf, proof: proofs[i] });
  }
  const tampered = { ...entries[0].entry, note: "tampered" };
  console.log(`  tampered entry verifies? ${await reg.verifyBatchEntry(tampered, entries[0].signature, proofs[0], root)}`);

  const dir = path.join(__dirname, "..", "batches");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${network.name}-demo.json`), JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e.message || e);
  process.exitCode = 1;
});
