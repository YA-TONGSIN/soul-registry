/* Ieum Ledger · donation page. Display-only: shows the owner's configured address + a locally generated QR.
 * No network calls (CSP connect-src 'none'); the address comes from config.js and is validated first.
 */
(function () {
  "use strict";
  const CFG = window.IEUM_CONFIG;
  const I18N = window.IEUM_I18N;
  const $ = (id) => document.getElementById(id);
  let lang = (localStorage.getItem("ieum-lang") || (navigator.language || "ko").slice(0, 2)) === "en" ? "en" : "ko";
  const state = window.IEUM_DONATION_CHECK(CFG);

  function t(key, vars) {
    let s = (I18N[lang] && I18N[lang][key]) || I18N.ko[key] || key;
    if (vars) for (const k of Object.keys(vars)) s = s.split("{" + k + "}").join(String(vars[k]));
    return s;
  }

  function renderQr(address) {
    const qr = window.qrcode(0, "M");
    qr.addData(address);
    qr.make();
    const n = qr.getModuleCount(), q = 4; // quiet zone
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", `0 0 ${n + q * 2} ${n + q * 2}`);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", t("donQrAlt"));
    svg.setAttribute("shape-rendering", "crispEdges");
    const bg = document.createElementNS(NS, "rect");
    bg.setAttribute("width", n + q * 2); bg.setAttribute("height", n + q * 2); bg.setAttribute("fill", "#ffffff");
    svg.append(bg);
    let dpath = "";
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) dpath += `M${c + q} ${r + q}h1v1h-1z`;
    const p = document.createElementNS(NS, "path");
    p.setAttribute("d", dpath); p.setAttribute("fill", "#000000");
    svg.append(p);
    $("qrBox").replaceChildren(svg);
  }

  function render() {
    document.documentElement.lang = lang;
    document.title = t("donTitle");
    document.querySelectorAll("[data-i18n]").forEach((n) => (n.textContent = t(n.dataset.i18n)));
    document.querySelectorAll(".seg").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.lang === lang)));
    const f = CFG.footer;
    $("donFree").textContent = (f && f.free && f.free[lang]) || "";
    $("donOn").hidden = !state.ok;
    $("donOff").hidden = state.ok;
    if (!state.ok) return;
    const d = state.d;
    const net = d.network[lang], assets = d.assets.join(" / ");
    $("donNetwork").textContent = net;
    $("donAssets").textContent = assets;
    $("donAddress").textContent = d.address;
    $("donWarn").textContent = t("donWarn", { network: net, assets });
    $("donExchange").textContent = t("donExchange", { network: net });
    const extra = d.note && d.note[lang];
    $("donNote").hidden = !extra;
    $("donNote").textContent = extra || "";
    renderQr(d.address);
  }

  async function copy() {
    const addr = state.d.address, msg = $("copyMsg");
    try {
      await navigator.clipboard.writeText(addr);
    } catch (e) {
      const ta = document.createElement("textarea");
      ta.value = addr; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.left = "-999px";
      document.body.append(ta); ta.select();
      let ok = false;
      try { ok = document.execCommand("copy"); } catch (e2) { ok = false; }
      ta.remove();
      if (!ok) { msg.className = "msg err"; msg.textContent = t("donCopyFail"); return; }
    }
    msg.className = "msg ok";
    msg.textContent = t("donCopied");
  }

  document.querySelectorAll(".seg").forEach((b) => b.addEventListener("click", () => {
    lang = b.dataset.lang; localStorage.setItem("ieum-lang", lang); render();
  }));
  $("copyBtn").addEventListener("click", copy);
  render();
})();
