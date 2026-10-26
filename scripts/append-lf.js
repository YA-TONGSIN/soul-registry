const { ethers } = require("hardhat");
const { registry, printHistory } = require("./common");
const HASHES = [
  "0x47b9dcfd48950363090c1b0a7c674dc6e682d1143bd9614d48d2d34b5e146e0c",
  "0x" + "b5fa12a7daf11fc04d19884e7e6a0b213c0cda9ceb0f88ae73fde8ff756896e5",
  "0x29d94d231638bfc0e2dee082aedb985a2d0b4690e990c8256c447b2e33bf4e0f",
];
async function main() {
  const reg = await registry();
  const [signer] = await ethers.getSigners();
  const bal = await ethers.provider.getBalance(signer.address);
  console.log("wallet", signer.address, "balance ETH", ethers.formatEther(bal));
  if (process.env.DRY) { await printHistory(reg, 1n); return; }
  if (bal < ethers.parseEther("0.00001")) { console.log("LOW BALANCE - stop"); return; }
  for (const h of HASHES) {
    const a = await reg.getAgent(1n);
    if (await reg.hasSoul(1n, h)) { console.log("already", h); continue; }
    const tx = await reg.appendSoul(1n, h, a.headHash, "LF-normalized hashes matching OpenTimestamps proofs");
    const rc = await tx.wait();
    console.log("appended", h, "tx", tx.hash, "block", rc.blockNumber);
  }
  await printHistory(reg, 1n);
  console.log("balance after", ethers.formatEther(await ethers.provider.getBalance(signer.address)));
}
main().catch((e) => { console.error(e.message || e); process.exitCode = 1; });

