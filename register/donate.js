/* Ieum Ledger · donation page. Display-only: shows the owner's configured address + a locally generated QR.
 * No external network (CSP connect-src 'self'): the only request is a GET of the static donors.json next to this page.
 * The address comes from config.js and is validated first. Donor names are opt-in (wallet-signed, verified offline by the operator).
 */
(function () {
  "use strict";
  const CFG = window.IEUM_CONFIG;
  const I18N = window.IEUM_I18N;
  const $ = (id) => document.getElementById(id);
  let lang = (localStorage.getItem("ieum-lang") || (navigator.language || "ko").slice(0, 2)) === "en" ? "en" : "ko";
  const DN = window.IEUM_DONOR_NAME;
  const state = window.IEUM_DONATION_CHECK(CFG);
  let donors = null; // parsed donors.json, or {error:true}

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

  // status lines (sign / copy) are kept as functions so a language switch re-translates what is already shown
  const live = {};
  function setLive(id, cls, fn) { const m = $(id); live[id] = fn; m.className = "msg" + (cls ? " " + cls : ""); m.textContent = fn ? fn() : ""; }
  function render() {
    for (const id of Object.keys(live)) if (live[id]) $(id).textContent = live[id]();
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
    renderDonors();
    $("signNoWallet").hidden = !!window.ethereum; $("signForm").hidden = !window.ethereum;
    const mail = CFG.footer && CFG.footer.contactEmail;
    const ml = $("signMail"); ml.textContent = mail || ""; if (mail) ml.href = "mailto:" + mail; else ml.removeAttribute("href");
  }

  // ── donor list ──
  const TOKENS = { USDC: { dec: 6, shown: 2 }, ETH: { dec: 18, shown: 5 } };
  function fmtUnits(raw, dec, minFrac) {
    const s = raw.toString().padStart(dec + 1, "0");
    const int = s.slice(0, s.length - dec);
    let frac = s.slice(s.length - dec).replace(/0+$/, "");
    while (frac.length < minFrac) frac += "0";
    return frac ? int + "." + frac : int;
  }
  function cleanDonation(d) {
    if (!d || !TOKENS[d.token] || !/^\d+$/.test(String(d.raw)) || !DN.isTx(d.txHash) || !/^0x[0-9a-fA-F]{40}$/.test(String(d.from)) || isNaN(Date.parse(d.time))) return null;
    const nm = d.name ? DN.check(d.name) : { ok: false };
    return { token: d.token, raw: BigInt(d.raw), txHash: DN.normTx(d.txHash), from: d.from, time: d.time, name: nm.ok ? nm.name : null };
  }
  function renderDonors() {
    const list = $("donorsList"), total = $("donorsTotal"), empty = $("donorsEmpty"), fail = $("donorsFail"), upd = $("donorsUpdated");
    list.replaceChildren(); total.hidden = empty.hidden = fail.hidden = upd.hidden = true;
    if (!donors) return;
    if (donors.error) { fail.textContent = t("donorsFail"); fail.hidden = false; return; }
    const rows = (Array.isArray(donors.donations) ? donors.donations : []).map(cleanDonation).filter(Boolean).slice(0, 200);
    if (!rows.length) { empty.textContent = t("donorsEmpty"); empty.hidden = false; return; }
    const sums = {};
    for (const r of rows) sums[r.token] = (sums[r.token] || 0n) + r.raw;
    total.textContent = t("donorsTotal", { sum: Object.keys(TOKENS).filter((k) => sums[k] !== undefined).map((k) => fmtUnits(sums[k], TOKENS[k].dec, TOKENS[k].shown === 2 ? 2 : 0) + " " + k).join(" + ") });
    total.hidden = false;
    for (const r of rows) {
      const li = document.createElement("li");
      const nm = document.createElement("span"); nm.className = "dname";
      nm.textContent = r.name || t("donorAnon", { addr: DN.shortAddr(r.from) });
      const amt = document.createElement("span"); amt.className = "damt";
      amt.textContent = fmtUnits(r.raw, TOKENS[r.token].dec, TOKENS[r.token].shown === 2 ? 2 : 0) + " " + r.token;
      const meta = document.createElement("span"); meta.className = "dmeta";
      meta.textContent = r.time.slice(0, 10) + " · ";
      const a = document.createElement("a");
      a.href = "https://basescan.org/tx/" + r.txHash; a.rel = "noopener noreferrer"; a.target = "_blank";
      a.textContent = t("donorView");
      meta.append(a);
      li.append(nm, amt, meta);
      list.append(li);
    }
    if (donors.updatedAt && !isNaN(Date.parse(donors.updatedAt))) { upd.textContent = t("donorsUpdated", { date: String(donors.updatedAt).slice(0, 10) }); upd.hidden = false; }
  }
  async function loadDonors() {
    try {
      const res = await fetch("donors.json", { cache: "no-store", credentials: "omit" });
      if (!res.ok) throw new Error("http " + res.status);
      donors = await res.json();
    } catch (e) { donors = { error: true }; }
    renderDonors();
  }

  // ── opt-in name: sign "Ieum Ledger donor name: <name> | tx: <hash>" in the wallet (EIP-191 personal_sign), offer the JSON for download ──
  function setSignMsg(key, cls, vars) { setLive("signMsg", cls, key ? () => t(key, vars) : null); }
  async function sign() {
    const c = DN.check($("signName").value);
    if (!c.ok) return setSignMsg("signErr_" + c.reason, "err");
    if (!DN.isTx($("signTx").value)) return setSignMsg("signErrTx", "err");
    const tx = DN.normTx($("signTx").value), msg = DN.message(c.name, tx);
    try {
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
      const account = accounts[0];
      const hit = donors && Array.isArray(donors.donations) ? donors.donations.filter((d) => d && DN.normTx(d.txHash) === tx) : [];
      if (hit.length && !hit.some((d) => String(d.from).toLowerCase() === account.toLowerCase())) return setSignMsg("signWrongWallet", "err");
      const hex = "0x" + Array.from(new TextEncoder().encode(msg)).map((b) => b.toString(16).padStart(2, "0")).join("");
      const signature = await window.ethereum.request({ method: "personal_sign", params: [hex, account] });
      const blob = new Blob([JSON.stringify({ name: c.name, txHash: tx, signer: account, message: msg, signature }, null, 2) + "\n"], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "ieum-donor-name-" + tx.slice(2, 10) + ".json";
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      setLive("signMsg", "ok", () => t("signDone") + (hit.length ? "" : " " + t("signNotListed")));
    } catch (e) {
      const rejected = e && (e.code === 4001 || e.code === "ACTION_REJECTED"), raw = String((e && e.message) || e).slice(0, 200);
      setLive("signMsg", "err", () => (rejected ? t("signRejected") : raw));
    }
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
      if (!ok) { setLive("copyMsg", "err", () => t("donCopyFail")); return; }
    }
    setLive("copyMsg", "ok", () => t("donCopied"));
  }

  document.querySelectorAll(".seg").forEach((b) => b.addEventListener("click", () => {
    lang = b.dataset.lang; localStorage.setItem("ieum-lang", lang); render();
  }));
  $("copyBtn").addEventListener("click", copy);
  $("signBtn").addEventListener("click", sign);
  render();
  if (state.ok) loadDonors();
})();
