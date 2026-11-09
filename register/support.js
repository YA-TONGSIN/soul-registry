/* Ieum Ledger · support page. Shows the Buy Me a Coffee link from config.js (footer.coffee) and nothing else.
 * Crypto donation was removed on 2026-11-09 (owner decision); the old page lives in archive/crypto-donation/.
 */
(function () {
  "use strict";
  const CFG = window.IEUM_CONFIG;
  const I18N = window.IEUM_I18N;
  const $ = (id) => document.getElementById(id);
  let lang = (localStorage.getItem("ieum-lang") || (navigator.language || "ko").slice(0, 2)) === "en" ? "en" : "ko";
  const t = (key) => (I18N[lang] && I18N[lang][key]) || I18N.ko[key] || key;

  function render() {
    document.documentElement.lang = lang;
    document.querySelectorAll("[data-i18n]").forEach((n) => (n.textContent = t(n.dataset.i18n)));
    document.querySelectorAll("[data-lang]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.lang === lang)));
    const f = CFG.footer;
    $("donFree").textContent = (f && f.free && f.free[lang]) || "";
    window.IEUM_COFFEE_CARD($("donCoffee"), CFG, t, lang);
  }

  document.querySelectorAll("[data-lang]").forEach((b) => b.addEventListener("click", () => {
    lang = b.dataset.lang;
    localStorage.setItem("ieum-lang", lang);
    render();
  }));
  render();
})();
