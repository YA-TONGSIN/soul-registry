// npx hardhat run scripts/deploy.js --network <localhost|baseSepolia>
const fs = require("fs");
const path = require("path");
const { ethers, network } = require("hardhat");

async function main() {
  if (!["localhost", "hardhat", "baseSepolia"].includes(network.name)) {
    throw new Error(`Refusing to deploy to '${network.name}': prototype is local/testnet only.`);
  }
  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("No deployer account (testnet key file missing?)");
  const bal = await ethers.provider.getBalance(deployer.address);
  console.log(`network=${network.name} deployer=${deployer.address} balance=${ethers.formatEther(bal)} ETH`);
  if (bal === 0n) throw new Error("Deployer has 0 ETH — get testnet ETH from a faucet first.");

  const reg = await ethers.deployContract("SoulRegistry");
  const receipt = await reg.deploymentTransaction().wait();
  const address = await reg.getAddress();
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  console.log(`SoulRegistry deployed at ${address} (gasUsed=${receipt.gasUsed})`);

  const dir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${network.name}.json`),
    JSON.stringify({ network: network.name, chainId, address, tx: receipt.hash, deployedAt: new Date().toISOString() }, null, 2)
  );
}

main().catch((e) => {
  console.error(e.message || e);
  process.exitCode = 1;
});
