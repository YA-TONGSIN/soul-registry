const fs = require("fs");
const path = require("path");
const { ethers, network } = require("hardhat");

async function registry() {
  const file = path.join(__dirname, "..", "deployments", `${network.name}.json`);
  if (!fs.existsSync(file)) throw new Error(`No deployment for ${network.name}; run scripts/deploy.js first`);
  const { address } = JSON.parse(fs.readFileSync(file, "utf8"));
  return ethers.getContractAt("SoulRegistry", address);
}

async function printHistory(reg, agentId) {
  const a = await reg.getAgent(agentId);
  const when = (t) => new Date(Number(t) * 1000).toISOString();
  console.log(`Agent #${a.id} "${a.name}" owner=${a.owner} created=${when(a.createdAt)}`);
  console.log(`  note="${a.note}"`);
  console.log(`  head=${a.headHash} records=${a.recordCount} chainValid=${await reg.verifyChain(agentId)}`);
  const hist = await reg.getHistory(agentId);
  hist.forEach((r, i) => {
    console.log(`  [v${i + 1}] ${when(r.timestamp)}`);
    console.log(`       soul   ${r.soulHash}`);
    console.log(`       parent ${r.parentHash}`);
    console.log(`       note   ${r.note}`);
  });
}

module.exports = { registry, printHistory };
