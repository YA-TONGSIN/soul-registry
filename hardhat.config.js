require("@nomicfoundation/hardhat-toolbox");
const fs = require("fs");

// TESTNET ONLY key, kept outside the repo. Never put a mainnet key here.
const KEY_FILE = process.env.SOUL_REGISTRY_KEY_FILE || "D:\\openclaw-backup\\.soul-registry-testnet.key";
function testnetAccounts() {
  try {
    const k = fs.readFileSync(KEY_FILE, "utf8").match(/0x[0-9a-fA-F]{64}/);
    return k ? [k[0]] : [];
  } catch {
    return [];
  }
}

module.exports = {
  solidity: {
    version: "0.8.24",
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
  networks: {
    localhost: { url: "http://127.0.0.1:8545" },
    baseSepolia: {
      url: process.env.BASE_SEPOLIA_RPC || "https://sepolia.base.org", // public RPC, rate-limited
      chainId: 84532,
      accounts: testnetAccounts(),
    },
  },
};
