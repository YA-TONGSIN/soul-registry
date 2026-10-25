#!/usr/bin/env node
// Ieum Ledger · operator tool: add a donor's opt-in display name after VERIFYING their wallet signature. Offline (no network).
//   node scripts/add-donor-name.js <signed.json> [more.json ...]
// signed.json (downloaded by the donor from donate.html): { name, txHash, signer, message, signature }
// Accepted only if: name passes the rules · message is exactly "Ieum Ledger donor name: <name> | tx: <txHash>"
//   · the EIP-191 signature recovers to `signer` · that tx is in register/donors.json and its `from` == signer.
// Then data/donor-names.json is updated and the names are merged into register/donors.json (run update-donors.js later = same result).
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
const DN = require("../register/donor-name.js");

const ROOT = path.join(__dirname, "..");
const NAMES = path.join(ROOT, "data", "donor-names.json");
const DONORS = path.join(ROOT, "register", "donors.json");

// pure verification, also used by the e2e test: returns {ok:true, entry} | {ok:false, reason}
function verify(signed, donations) {
  if (!signed || typeof signed !== "object") return { ok: false, reason: "not an object" };
  const c = DN.check(signed.name);
  if (!c.ok) return { ok: false, reason: "name rejected: " + c.reason };
  if (!DN.isTx(signed.txHash)) return { ok: false, reason: "bad txHash" };
  const tx = DN.normTx(signed.txHash);
  if (signed.message !== DN.message(c.name, tx)) return { ok: false, reason: "message does not match name/tx" };
  let rec;
  try { rec = ethers.verifyMessage(signed.message, signed.signature); } catch { return { ok: false, reason: "bad signature" }; }
  if (!signed.signer || rec.toLowerCase() !== String(signed.signer).toLowerCase()) return { ok: false, reason: "signature does not match signer" };
  const hits = donations.filter((d) => d.txHash === tx);
  if (!hits.length) return { ok: false, reason: "tx not in donors.json (run update-donors.js first)" };
  if (!hits.some((d) => d.from.toLowerCase() === rec.toLowerCase())) return { ok: false, reason: "signer is not the sender of that tx" };
  return { ok: true, entry: { name: c.name, signer: ethers.getAddress(rec), signature: signed.signature, message: signed.message } , tx };
}

function main() {
  const files = process.argv.slice(2);
  if (!files.length) { console.error("usage: node scripts/add-donor-name.js <signed.json> ..."); process.exit(2); }
  const donors = JSON.parse(fs.readFileSync(DONORS, "utf8"));
  const names = fs.existsSync(NAMES) ? JSON.parse(fs.readFileSync(NAMES, "utf8")) : {};
  let bad = 0;
  for (const f of files) {
    let signed;
    try { signed = JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { console.log(`REJECT ${f}: unreadable JSON`); bad++; continue; }
    const r = verify(signed, donors.donations);
    if (!r.ok) { console.log(`REJECT ${f}: ${r.reason}`); bad++; continue; }
    names[r.tx] = r.entry;
    console.log(`OK     ${f}: "${r.entry.name}" for ${r.tx} (${r.entry.signer})`);
  }
  fs.mkdirSync(path.dirname(NAMES), { recursive: true });
  fs.writeFileSync(NAMES, JSON.stringify(names, null, 2) + "\n");
  for (const d of donors.donations) {
    const n = names[d.txHash];
    if (n && n.signer.toLowerCase() === d.from.toLowerCase()) d.name = n.name; else delete d.name;
  }
  fs.writeFileSync(DONORS, JSON.stringify(donors, null, 2) + "\n");
  process.exit(bad ? 1 : 0);
}
if (require.main === module) main();
module.exports = { verify };
