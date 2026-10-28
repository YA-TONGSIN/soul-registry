// Shared helpers for the auto-record flow (watch-soul.js / approve-soul.js / check-soul.js --batches-dir).
// Only fingerprints, names and notes are handled here - never SOUL text.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const sha256Hex = (buf) => "0x" + crypto.createHash("sha256").update(buf).digest("hex");
const isHash = (h) => typeof h === "string" && /^0x[0-9a-fA-F]{64}$/.test(h);

// CRLF / lone CR -> LF (same rule as check-soul.js and the ledger's LF entries).
function normalizeLF(buf) {
  const out = [];
  for (let i = 0; i < buf.length; i++) {
    const c = buf[i];
    if (c === 0x0d) { out.push(0x0a); if (buf[i + 1] === 0x0a) i++; } else out.push(c);
  }
  return Buffer.from(out);
}

// Per-line SHA-256 (hex, no 0x). Used only to count changed lines without storing text.
function lineHashes(buf) {
  const text = normalizeLF(buf).toString("utf8");
  if (text === "") return [];
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines.map((l) => crypto.createHash("sha256").update(l, "utf8").digest("hex"));
}

// added + removed lines (multiset difference; pure reordering is not counted).
function diffLineCount(prevHashes, nextHashes) {
  const bag = new Map();
  for (const h of prevHashes) bag.set(h, (bag.get(h) || 0) + 1);
  let added = 0;
  for (const h of nextHashes) {
    const n = bag.get(h) || 0;
    if (n > 0) bag.set(h, n - 1); else added++;
  }
  let removed = 0;
  for (const n of bag.values()) removed += n;
  return added + removed;
}

// Signed entries written by approve-soul.js: <dir>/signed-a<agent>-<hash8>.json
function readSignedEntries(dir, agentId) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const f of fs.readdirSync(dir)) {
    if (!/^signed-a\d+-[0-9a-f]{8}\.json$/.test(f)) continue;
    let j;
    try { j = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); } catch { continue; }
    if (!j || !j.entry || String(j.agentId) !== String(agentId) || !isHash(j.entry.soulHash) || typeof j.signature !== "string") continue;
    out.push({ file: path.join(dir, f), ...j });
  }
  return out.sort((a, b) => Number(BigInt(a.entry.signedAt) - BigInt(b.entry.signedAt)));
}

// chain: { head, hist: [lowercase hashes] } -> same shape with signed entries appended in signedAt order.
// A signed entry counts only if its parentHash equals the current latest hash (clock-free chain rule), so an old signed entry
// that the ledger has since moved past is ignored. Entries must be sorted by signedAt (readSignedEntries does that).
function mergeSigned(chain, signed) {
  const hist = chain.hist.slice();
  for (const s of signed) {
    const h = s.entry.soulHash.toLowerCase();
    const last = hist[hist.length - 1];
    if (last !== h && String(s.entry.parentHash).toLowerCase() === last) hist.push(h);
  }
  return { ...chain, hist, head: hist[hist.length - 1] };
}

module.exports = { sha256Hex, isHash, normalizeLF, lineHashes, diffLineCount, readSignedEntries, mergeSigned };
