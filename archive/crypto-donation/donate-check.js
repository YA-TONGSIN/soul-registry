// Donation config check, shared by index.html (footer link) and donate.html (page body).
// Returns {ok:true, d} only when the owner has switched donation on AND the address/network/assets are well-formed.
// Anything else -> {ok:false}: no link, no address, no QR. (Display-only; nothing here sends or signs anything.)
(function () {
  "use strict";
  var TYPES = {
    evm: /^0x[0-9a-fA-F]{40}$/,                 // EVM chains (Base, Ethereum, Polygon…): 0x + 40 hex
    other: /^[A-Za-z0-9:_\-.]{20,120}$/,         // other chains (BTC, SOL, TRX…): simple sanity check only
  };
  function nonEmpty(v) { return typeof v === "string" && v.trim().length > 0; }
  function check(cfg) {
    var d = cfg && cfg.footer && cfg.footer.donation;
    if (!d || d.enabled !== true) return { ok: false };
    var re = TYPES[d.addressType];
    if (!re || typeof d.address !== "string" || !re.test(d.address)) return { ok: false };
    if (!d.network || !nonEmpty(d.network.ko) || !nonEmpty(d.network.en)) return { ok: false };
    if (!Array.isArray(d.assets) || !d.assets.length || !d.assets.every(nonEmpty)) return { ok: false };
    if (typeof d.page !== "string" || !/^[A-Za-z0-9_\-]+\.html$/.test(d.page)) return { ok: false };
    return { ok: true, d: d };
  }
  window.IEUM_DONATION_CHECK = check;
})();
