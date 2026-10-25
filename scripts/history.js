// $env:AGENT_ID=1; npx hardhat run scripts/history.js --network localhost
const { registry, printHistory } = require("./common");

async function main() {
  const reg = await registry();
  const id = BigInt(process.env.AGENT_ID || "1");
  await printHistory(reg, id);
  const scores = await reg.getScores(id);
  for (const s of scores) {
    console.log(`  carry-over ${s.fromModel} -> ${s.toModel} score=${Number(s.scoreBps) / 100}% report=${s.reportHash}`);
  }
  console.log(`batches anchored: ${await reg.batchCount()}`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exitCode = 1;
});
