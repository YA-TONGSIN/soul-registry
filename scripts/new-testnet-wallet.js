// Creates a TESTNET-ONLY wallet. The private key is written only to the key file and never printed.
// node scripts/new-testnet-wallet.js
const fs = require("fs");
const { execFileSync } = require("child_process");
const { ethers } = require("ethers");

const KEY_FILE = process.env.SOUL_REGISTRY_KEY_FILE || "D:\\openclaw-backup\\.soul-registry-testnet.key";
if (fs.existsSync(KEY_FILE)) {
  const addr = fs.readFileSync(KEY_FILE, "utf8").match(/# address (0x[0-9a-fA-F]{40})/);
  console.log(`exists: ${addr ? addr[1] : "(address line missing)"}`);
  process.exit(0);
}
const w = ethers.Wallet.createRandom();
fs.writeFileSync(
  KEY_FILE,
  `# TESTNET ONLY (Base Sepolia 84532). Never send real ETH here, never use on mainnet.\n# address ${w.address}\n${w.privateKey}\n`,
  { mode: 0o600 }
);
if (process.platform === "win32") execFileSync("attrib", ["+h", KEY_FILE]);
console.log(`created: ${w.address}`);
