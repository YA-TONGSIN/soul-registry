// Ieum Ledger · donor-name rules, shared by the browser (donate.js) and the operator scripts (add-donor-name.js).
// Pure functions, no network. A donor may OPT IN to a public display name by signing this exact message with the
// wallet that sent the donation. Anything not signed (or not passing these rules) is shown as anonymous.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.IEUM_DONOR_NAME = factory();
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";
  var MAX_LEN = 24;
  var TX = /^0x[0-9a-f]{64}$/;
  // letters/digits of any language, space, _ - '   (no . @ / : | so no URL, e-mail, handle, or message-delimiter tricks)
  var ALLOWED = /^[\p{L}\p{N} _'-]+$/u;
  // very small blocklist (ko/en); the operator also reads every name before adding it.
  var BAD = /(씨발|시발|ㅅㅂ|병신|지랄|개새끼|좆|fuck|shit|bitch|nigg|http|www|kakao|telegram|whatsapp|discord)/i;

  function normalize(name) {
    return String(name == null ? "" : name).normalize("NFC").replace(/\s+/g, " ").trim();
  }
  // -> {ok:true, name} | {ok:false, reason}
  function check(raw) {
    var name = normalize(raw);
    if (!name) return { ok: false, reason: "empty" };
    if (Array.from(name).length > MAX_LEN) return { ok: false, reason: "long" };
    if (!ALLOWED.test(name)) return { ok: false, reason: "chars" };
    if (/\d{5,}/.test(name.replace(/[ _'-]/g, ""))) return { ok: false, reason: "digits" }; // phone / account numbers
    if (BAD.test(name.replace(/[ _'-]/g, ""))) return { ok: false, reason: "bad" };
    return { ok: true, name: name };
  }
  function normTx(tx) { return String(tx == null ? "" : tx).trim().toLowerCase(); }
  function isTx(tx) { return TX.test(normTx(tx)); }
  function message(name, tx) { return "Ieum Ledger donor name: " + name + " | tx: " + normTx(tx); }
  function shortAddr(a) { a = String(a); return a.slice(0, 6) + "…" + a.slice(-4); }
  return { MAX_LEN: MAX_LEN, check: check, normalize: normalize, normTx: normTx, isTx: isTx, message: message, shortAddr: shortAddr };
});
