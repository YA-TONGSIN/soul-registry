// Ieum Ledger · register page — the ONLY place networks are configured.
// The page refuses any network that is not listed here with testnet:true.
//
// ─── MAINNET (disabled on purpose) ─────────────────────────────────────────
// To go live later (the owner decides when; needs real ETH for gas):
//   1. Deploy SoulRegistry to the target chain and write its address below.
//   2. Uncomment the "base" entry, set testnet:false, and set allowMainnet:true.
//   3. Add the RPC host to the Content-Security-Policy `connect-src` in index.html.
//   4. Re-run the e2e test, then publish. Until then nothing below can connect to mainnet.
//
//   base: {
//     chainId: 8453,
//     label: { ko: "Base 메인넷", en: "Base mainnet" },
//     rpcUrl: "https://mainnet.base.org",
//     registry: "0x…(not deployed)",
//     testnet: false,
//     explorer: "https://basescan.org",
//     currency: { name: "Ether", symbol: "ETH", decimals: 18 },
//   },
// ───────────────────────────────────────────────────────────────────────────
window.IEUM_CONFIG = {
  defaultNetwork: "baseSepolia",
  // Footer (confirmed by the owner 2026-10-25 21:18). enabled=false hides the whole footer extra.
  // donation: slot only, off by default; when off nothing is shown. Do NOT put a link/bank account
  // here until the owner provides one.
  footer: {
    enabled: true,
    maker: { ko: "만든 사람: 신운종 · 이음(Ieum)", en: "Made by Wunjong Shin · Ieum" },
    contactLabel: { ko: "문의", en: "Contact" },
    contactEmail: "dkakrptehsrk@gmail.com",
    free: { ko: "이 장부는 무료입니다.", en: "This ledger is free." },
    donation: { enabled: false, label: { ko: "", en: "" }, url: "" },
  },
  allowMainnet: false, // keep false until the owner approves a public launch
  networks: {
    localhost: {
      chainId: 31337,
      label: { ko: "내 컴퓨터 시험 체인 (localhost)", en: "Local test chain (localhost)" },
      rpcUrl: "http://127.0.0.1:8545",
      registry: "0x5FbDB2315678afecb367f032d93F642f64180aa3", // deployments/localhost.json
      testnet: true,
      explorer: null,
      currency: { name: "Ether", symbol: "ETH", decimals: 18 },
    },
    baseSepolia: {
      chainId: 84532,
      label: { ko: "Base Sepolia 시험망 (가짜 이더)", en: "Base Sepolia testnet (play money)" },
      rpcUrl: "https://sepolia.base.org",
      registry: "0xA28a899E3b7255cea1cDc7d92b6ce7FAFBE9F237", // deployments/baseSepolia.json
      testnet: true,
      explorer: "https://sepolia.basescan.org",
      currency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
    },
  },
};
