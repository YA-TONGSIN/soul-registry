// Read-only cost estimate for one anchorBatch per day on Base mainnet (no tx is sent).
// node scripts/estimate-cost.js [gasUsed]
const { ethers } = require("ethers");

const RPC = process.env.BASE_RPC || "https://mainnet.base.org";
const ORACLE = "0x420000000000000000000000000000000000000F"; // OP-stack GasPriceOracle predeploy
const GAS = BigInt(process.argv[2] || "115609"); // measured anchorBatch gasUsed (first batch, worst case)

async function main() {
  const p = new ethers.JsonRpcProvider(RPC);
  const block = await p.getBlock("latest");
  const fee = await p.getFeeData();
  const oracle = new ethers.Contract(
    ORACLE,
    ["function getL1Fee(bytes) view returns (uint256)", "function getL1FeeUpperBound(uint256) view returns (uint256)"],
    p
  );
  // anchorBatch(bytes32,uint32) calldata = 4 + 32 + 32 bytes; wrap in a rough unsigned EIP-1559 tx shape
  const iface = new ethers.Interface(["function anchorBatch(bytes32 root, uint32 count)"]);
  const data = iface.encodeFunctionData("anchorBatch", [ethers.keccak256("0x01"), 1000]);
  const unsigned = ethers.Transaction.from({
    type: 2, chainId: 8453, nonce: 1000, to: ethers.ZeroAddress.replace(/0$/, "1"), data,
    gasLimit: 200000, maxFeePerGas: fee.maxFeePerGas, maxPriorityFeePerGas: fee.maxPriorityFeePerGas,
  }).unsignedSerialized;
  let l1 = 0n;
  try { l1 = await oracle.getL1Fee(unsigned); } catch { l1 = await oracle.getL1FeeUpperBound(ethers.dataLength(unsigned)); }

  const base = block.baseFeePerGas;
  const prio = fee.maxPriorityFeePerGas ?? 0n;
  const l2 = GAS * (base + prio);
  const total = l2 + l1;
  let usd = null;
  try {
    const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd,krw");
    usd = (await r.json()).ethereum;
  } catch {}
  const eth = Number(ethers.formatEther(total));
  console.log(JSON.stringify({
    rpc: RPC, block: block.number, time: new Date(block.timestamp * 1000).toISOString(),
    baseFeeGwei: ethers.formatUnits(base, "gwei"), priorityGwei: ethers.formatUnits(prio, "gwei"),
    gasUsed: GAS.toString(), l2FeeEth: ethers.formatEther(l2), l1DataFeeEth: ethers.formatEther(l1),
    totalEth: eth, ethPrice: usd,
    perDayUsd: usd ? eth * usd.usd : null, perDayKrw: usd ? eth * usd.krw : null,
    per365Krw: usd ? eth * usd.krw * 365 : null,
  }, null, 2));
}
main().catch((e) => { console.error(e.message || e); process.exitCode = 1; });
