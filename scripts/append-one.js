// Append one LF-normalized SOUL hash to an agent. Usage:
//   HASH=0x... NOTE="..." [AGENT=1] [DRY=1] npx hardhat run scripts/append-one.js --network baseSepolia
const { ethers } = require("hardhat");
const { registry, printHistory } = require("./common");
async function main() {
  const h = process.env.HASH;
  const agentId = BigInt(process.env.AGENT || "1");
  const note = process.env.NOTE || "";
  if (!/^0x[0-9a-f]{64}$/i.test(h || "")) throw new Error("HASH must be 0x + 64 hex");
  const reg = await registry();
  const [signer] = await ethers.getSigners();
  const bal = await ethers.provider.getBalance(signer.address);
  console.log("wallet", signer.address, "balance ETH", ethers.formatEther(bal));
  if (await reg.hasSoul(agentId, h)) { console.log("already", h); await printHistory(reg, agentId); return; }
  if (process.env.DRY) { await printHistory(reg, agentId); return; }
  if (bal < ethers.parseEther("0.00001")) { console.log("LOW BALANCE - stop"); return; }
  const a = await reg.getAgent(agentId);
  const tx = await reg.appendSoul(agentId, h, a.headHash, note);
  const rc = await tx.wait();
  console.log("appended", h, "tx", tx.hash, "block", rc.blockNumber);
  await printHistory(reg, agentId);
  console.log("balance after", ethers.formatEther(await ethers.provider.getBalance(signer.address)));
}
main().catch((e) => { console.error(e.message || e); process.exitCode = 1; });
