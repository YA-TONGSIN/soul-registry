// Registers Ieum as agent #1 and records SOUL v1..v4 as a parentHash chain.
// Only SHA-256 hashes and short English notes go on-chain — never SOUL text.
const fs = require("fs");
const crypto = require("crypto");
const { ethers } = require("hardhat");
const { registry, printHistory } = require("./common");

const HISTORY_DIR = process.env.IEUM_HISTORY_DIR || "D:\\openclaw-outputs\\soul-chain-ieum\\history";
const NOTES = [
  "v1 baseline: last backup before 2026-10-24 21:24",
  "v2 added rule-priority section (what can/cannot change); journal update",
  "v3 clarified who the primary user is (at their request)",
  "v4 append-only rule: keep earlier SOUL lines, add changes instead",
];

const sha256File = (f) => "0x" + crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");

async function main() {
  const reg = await registry();
  const [owner] = await ethers.getSigners();

  let agentId = 1n;
  if ((await reg.agentCount()) === 0n) {
    await (await reg.registerAgent("Ieum", "Korean AI assistant; SOUL history since 2026-10-24", "")).wait();
  }
  const agent = await reg.getAgent(agentId);
  if (agent.name !== "Ieum") throw new Error("agent #1 is not Ieum");

  let parent = agent.headHash;
  for (let v = 1; v <= 4; v++) {
    const soulHash = sha256File(`${HISTORY_DIR}\\SOUL_v${v}.md`);
    if (await reg.hasSoul(agentId, soulHash)) {
      parent = soulHash;
      continue;
    }
    const tx = await reg.connect(owner).appendSoul(agentId, soulHash, parent, NOTES[v - 1]);
    const rc = await tx.wait();
    console.log(`appended v${v} gasUsed=${rc.gasUsed}`);
    parent = soulHash;
  }
  await printHistory(reg, agentId);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exitCode = 1;
});
