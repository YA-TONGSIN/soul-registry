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
})();
