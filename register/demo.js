// One-character experiment: SHA-256 of a synthetic sample, computed in the browser only (crypto.subtle). Nothing is sent anywhere.
(function () {
  const box = document.getElementById("demoText");
  if (!box || !window.crypto || !crypto.subtle) return;
  const enc = new TextEncoder();
  const lang = () => (document.documentElement.lang === "en" ? "en" : "ko");
  const tr = (k, vars) => {
    let s = (window.IEUM_I18N[lang()] && window.IEUM_I18N[lang()][k]) || window.IEUM_I18N.ko[k] || k;
    if (vars) for (const v of Object.keys(vars)) s = s.split("{" + v + "}").join(String(vars[v]));
    return s;
  };
  async function sha(s) {
    const d = await crypto.subtle.digest("SHA-256", enc.encode(s));
    return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
  }
  let sample = tr("demoSample"), origHash = "", seq = 0;
  const $ = (id) => document.getElementById(id);
  function paint(node, hex, other) {
    node.textContent = "";
    for (let i = 0; i < hex.length; i++) {
      const c = document.createElement("span");
      c.textContent = hex[i];
      if (other && other[i] !== hex[i]) c.className = "dh";
      node.append(c);
    }
  }
  async function update() {
    const my = ++seq;
    const cur = await sha(box.value);
    if (my !== seq) return;
    paint($("demoOrig"), origHash, null);
    paint($("demoCur"), cur, origHash);
    const same = cur === origHash;
    let n = 0;
    for (let i = 0; i < 64; i++) if (cur[i] !== origHash[i]) n++;
    const st = $("demoStatus");
    st.textContent = same ? tr("demoSame") : tr("demoDiff");
    st.className = "demo-status " + (same ? "ok" : "bad");
    st.dataset.state = same ? "same" : "diff";
    $("demoCount").textContent = same ? "" : tr("demoDiffCount", { n });
  }
  async function init(resetText) {
    const prev = sample;
    sample = tr("demoSample");
    if (resetText || box.value === prev) box.value = sample;
    origHash = await sha(sample);
    update();
  }
  box.addEventListener("input", update);
  $("demoReset").addEventListener("click", () => { box.value = sample; update(); box.focus(); });
  document.querySelectorAll(".seg").forEach((b) => b.addEventListener("click", () => setTimeout(() => init(false), 0)));
  setTimeout(() => init(true), 0);
})();
