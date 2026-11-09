// Buy Me a Coffee link check, shared by index.html (footer) and donate.html. Returns {url,label} or null (hidden).
// Only an https://buymeacoffee.com/<name> URL is accepted; no widget, script or tracking is ever loaded.
(function () {
  "use strict";
  function coffee(cfg) {
    var c = cfg && cfg.footer && cfg.footer.coffee;
    if (!c || c.enabled !== true || typeof c.url !== "string") return null;
    if (!/^https:\/\/(www\.)?buymeacoffee\.com\/[A-Za-z0-9_.-]+$/.test(c.url)) return null;
    if (!c.label || typeof c.label.ko !== "string" || typeof c.label.en !== "string" || !c.label.ko || !c.label.en) return null;
    return { url: c.url, label: c.label };
  }
  window.IEUM_COFFEE_LINK = coffee;
  // Fills the shared support card (same layout as the sibling sites): label, title, hint, link button.
  window.IEUM_COFFEE_CARD = function (card, cfg, t, lang) {
    var cf = coffee(cfg);
    card.hidden = !cf;
    if (!cf) return;
    function mk(tag, cls, text) { var n = document.createElement(tag); n.className = cls; n.textContent = text; return n; }
    var a = mk("a", "go", cf.label[lang]);
    a.href = cf.url; a.target = "_blank"; a.rel = "noopener noreferrer";
    var row = mk("div", "row", ""); row.appendChild(a);
    card.replaceChildren(mk("div", "step", t("cardStep")), mk("h2", "dtitle", t("cardTitle")), mk("p", "dhint", t("cardHint")), row);
  };
})();
