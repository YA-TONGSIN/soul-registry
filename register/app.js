/* Ieum Ledger · register page.
 * Privacy guarantee (by code): SOUL bytes are only ever passed to ethers.sha256(). This file makes no
 * fetch/XHR/WebSocket/sendBeacon calls of its own; the only network traffic is ethers' JSON-RPC to the
 * configured chain, which carries hashes/short notes the user chose to publish (and the CSP blocks the rest).
 */
(function () {
  "use strict";
  const CFG = window.IEUM_CONFIG;
  const I18N = window.IEUM_I18N;
  const ABI = window.SOUL_REGISTRY_ABI;
  const { ethers } = window;
  const ZERO = ethers.ZeroHash;
  const MAX = { name: 64, note: 160, uri: 200 };
  const MAX_FILE_MB = 10;
  const enc = new TextEncoder();
  const $ = (id) => document.getElementById(id);

  // ───────────── helpers ─────────────
  let lang = (localStorage.getItem("ieum-lang") || (navigator.language || "ko").slice(0, 2)) === "en" ? "en" : "ko";
  function t(key, vars) {
    let s = (I18N[lang] && I18N[lang][key]) || I18N.ko[key] || key;
    if (vars) for (const k of Object.keys(vars)) s = s.split("{" + k + "}").join(String(vars[k]));
    return s;
  }
  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else n.setAttribute(k, v);
    }
    for (const k of kids.flat()) if (k != null) n.append(k.nodeType ? k : document.createTextNode(String(k)));
    return n;
  }
  const bytesOf = (s) => enc.encode(s).length;
  const isHash = (h) => /^0x[0-9a-fA-F]{64}$/.test(h);
  const when = (ts) => new Date(Number(ts) * 1000).toISOString().replace("T", " ").slice(0, 19) + " UTC";
  const short = (h) => h.slice(0, 10) + "…" + h.slice(-6);
  function setMsg(node, kind, text) {
    node.className = "msg " + (kind || "");
    node.textContent = text || "";
  }

  // ───────────── networks ─────────────
  const NETS = Object.entries(CFG.networks)
    .filter(([, n]) => n.testnet === true || (CFG.allowMainnet === true && n.testnet === false))
    .map(([key, n]) => ({ key, ...n }));
  let net = NETS.find((n) => n.key === (new URLSearchParams(location.search).get("net") || CFG.defaultNetwork)) || NETS[0];
  let reader = null;
  function readerReg() {
    if (!reader || reader.key !== net.key) {
      const p = new ethers.JsonRpcProvider(net.rpcUrl, net.chainId, { staticNetwork: true });
      reader = { key: net.key, provider: p, reg: new ethers.Contract(net.registry, ABI, p) };
    }
    return reader;
  }
  async function ensureContract() {
    const r = readerReg();
    const code = await r.provider.getCode(net.registry);
    if (code === "0x") throw new Error(t("noContract"));
    return r;
  }

  // ───────────── error text ─────────────
  function errText(e) {
    if (e && (e.code === "ACTION_REJECTED" || e.code === 4001 || (e.info && e.info.error && e.info.error.code === 4001))) return t("errRejected");
    const name = e && (e.revert && e.revert.name);
    const map = { BadParent: "errBadParent", DuplicateSoul: "errDuplicate", NotAgentOwner: "errNotOwner", TooLong: "errTooLong", EmptyName: "errEmptyName", UnknownAgent: "errUnknownAgent" };
    if (name && map[name]) return t(map[name]);
    return t("errGeneric", { msg: (e && (e.shortMessage || e.message)) || String(e) });
  }

  // ───────────── i18n / language ─────────────
  function applyLang() {
    document.documentElement.lang = lang;
    document.title = t("title");
    document.querySelectorAll("[data-i18n]").forEach((n) => (n.textContent = t(n.dataset.i18n)));
    document.querySelectorAll(".seg").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.lang === lang)));
    fillNetSelect();
    renderFooter();
    renderSoul();
    refreshWalletUi();
    updateCounts();
    updateSendLabel();
  }
  function renderFooter() {
    const f = CFG.footer;
    $("footerExtra").hidden = !(f && f.enabled);
    if (!(f && f.enabled)) return;
    $("footMaker").textContent = (f.maker && f.maker[lang]) || "";
    $("footFree").textContent = (f.free && f.free[lang]) || "";
    const cEl = $("footContact");
    cEl.hidden = !f.contactEmail;
    if (f.contactEmail) {
      const a = el("a", { href: "mailto:" + f.contactEmail, text: f.contactEmail });
      cEl.replaceChildren(document.createTextNode(((f.contactLabel && f.contactLabel[lang]) || "") + ": "), a);
    }
    const d = f.donation, dEl = $("footDonation");
    const dOn = !!(d && d.enabled && d.url && /^https:\/\//.test(d.url));
    dEl.hidden = !dOn;
    if (dOn) dEl.replaceChildren(el("a", { href: d.url, text: (d.label && d.label[lang]) || d.url, rel: "noopener" }));
  }
  function fillNetSelect() {
    const sel = $("net");
    sel.replaceChildren(...NETS.map((n) => el("option", { value: n.key, text: n.label[lang] + (n.testnet ? " · " + t("testnetBadge") : "") })));
    sel.value = net.key;
  }

  // ───────────── SOUL hashing (the only place content is touched) ─────────────
  let soul = null; // { kind, name, size, hash }
  function hashBytes(u8) {
    return ethers.sha256(u8); // SHA-256 of raw bytes, same rule as DESIGN.md / contract expectations
  }
  async function loadFile(file) {
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      soul = null;
      renderSoul();
      $("soulInfo").append(el("p", { class: "err", text: t("fileTooBig", { n: MAX_FILE_MB }) }));
      return;
    }
    const buf = new Uint8Array(await file.arrayBuffer());
    soul = { kind: "file", name: file.name, size: buf.length, hash: hashBytes(buf) };
    $("soulText").value = "";
    onSoulChanged();
  }
  function loadPasted(text) {
    if (!text) { soul = null; onSoulChanged(); return; }
    const buf = enc.encode(text);
    soul = { kind: "paste", name: "", size: buf.length, hash: hashBytes(buf) };
    $("soulFile").value = "";
    onSoulChanged();
  }
  function renderSoul() {
    const box = $("soulInfo");
    box.replaceChildren();
    $("clearSoul").hidden = !soul;
    if (!soul) { box.append(el("p", { class: "help", text: t("soulNone") })); return; }
    const copyBtn = el("button", { type: "button", class: "ghost", text: t("copy") });
    copyBtn.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(soul.hash); copyBtn.textContent = t("copied"); } catch { /* ignore */ }
    });
    box.append(
      el("dl", { class: "kv" },
        el("dt", { text: soul.kind === "file" ? t("soulFile") : t("soulPasted") }),
        el("dd", { text: (soul.kind === "file" ? soul.name + " · " : "") + t("soulSize", { n: soul.size }) }),
        el("dt", { text: t("soulHash") }),
        el("dd", {}, el("code", { id: "soulHashOut", text: soul.hash }), " ", copyBtn)),
      el("p", { class: "help", text: t("soulRule") })
    );
  }
  function onSoulChanged() {
    renderSoul();
    refreshAgentChecks();
    if (lookupState) renderLookup();
  }

  // ───────────── byte counters ─────────────
  function updateCounts() {
    document.querySelectorAll("input[data-limit]").forEach((inp) => {
      const max = Number(inp.dataset.limit);
      const n = bytesOf(inp.value);
      const c = $(inp.id + "C");
      if (!c) return;
      c.textContent = t("bytesCount", { n, max });
      c.classList.toggle("over", n > max);
      inp.setAttribute("aria-invalid", String(n > max));
    });
  }
  const over = (id) => bytesOf($(id).value) > Number($(id).dataset.limit);

  // ───────────── wallet ─────────────
  const wallet = { bp: null, address: null, chainId: null };
  async function connectWallet() {
    const msg = $("walletMsg");
    if (!window.ethereum) { setMsg(msg, "err", t("noWallet")); return; }
    try {
      wallet.bp = new ethers.BrowserProvider(window.ethereum, "any");
      const accts = await wallet.bp.send("eth_requestAccounts", []);
      wallet.address = ethers.getAddress(accts[0]);
      wallet.chainId = Number(await window.ethereum.request({ method: "eth_chainId" }));
      if (window.ethereum.on) {
        window.ethereum.on("chainChanged", async () => { wallet.chainId = Number(await window.ethereum.request({ method: "eth_chainId" })); refreshWalletUi(); });
        window.ethereum.on("accountsChanged", (a) => { wallet.address = a[0] ? ethers.getAddress(a[0]) : null; refreshWalletUi(); refreshAgentChecks(); });
      }
      setMsg(msg, "", "");
      refreshWalletUi();
      refreshAgentChecks();
    } catch (e) { setMsg(msg, "err", errText(e)); }
  }
  function refreshWalletUi() {
    const on = !!wallet.address;
    $("walletInfo").hidden = !on;
    $("connect").hidden = on;
    if (!on) { $("chainWarn").hidden = true; return; }
    $("wAccount").textContent = wallet.address;
    const match = wallet.chainId === net.chainId;
    $("wChain").textContent = wallet.chainId + (match ? " · " + t("chainOk") : "");
    $("wChain").className = match ? "ok" : "bad";
    $("chainWarn").hidden = match;
  }
  async function switchChain() {
    const hex = ethers.toQuantity(net.chainId);
    try {
      await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
    } catch (e) {
      if (e && (e.code === 4902 || (e.data && e.data.originalError && e.data.originalError.code === 4902))) {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [{ chainId: hex, chainName: net.label.en, rpcUrls: [net.rpcUrl], nativeCurrency: net.currency, blockExplorerUrls: net.explorer ? [net.explorer] : [] }],
        });
      } else { setMsg($("walletMsg"), "err", errText(e)); return; }
    }
    wallet.chainId = Number(await window.ethereum.request({ method: "eth_chainId" }));
    refreshWalletUi();
  }
  function walletReady(msgNode) {
    if (!wallet.address) { setMsg(msgNode, "err", t("needWallet")); return false; }
    if (wallet.chainId !== net.chainId) { setMsg(msgNode, "err", t("needChain")); return false; }
    return true;
  }

  // ───────────── tabs ─────────────
  function selectTab(name) {
    document.querySelectorAll("[role=tab]").forEach((b) => {
      const on = b.dataset.tab === name;
      b.setAttribute("aria-selected", String(on));
      b.tabIndex = on ? 0 : -1;
      $("panel-" + b.dataset.tab).hidden = !on;
    });
    $("walletCard").hidden = name === "lookup";
  }

  // ───────────── A: direct registration ─────────────
  let mode = "new";
  let agentCtx = null; // { id, agent, hist }
  function updateSendLabel() { $("sendDirect").textContent = t(mode === "new" ? "sendDirectNew" : "sendDirectAppend"); }
  function setMode(m) {
    mode = m;
    $("newFields").hidden = m !== "new";
    $("appendFields").hidden = m !== "append";
    $("estimateOut").textContent = "";
    updateSendLabel();
  }
  async function loadAgentCtx() {
    const box = $("agentBox");
    box.replaceChildren();
    agentCtx = null;
    const idRaw = $("dAgentId").value;
    if (!idRaw) { setMsg($("directMsg"), "err", t("needAgentId")); return; }
    try {
      const r = await ensureContract();
      const id = BigInt(idRaw);
      const a = await r.reg.getAgent(id);
      const hasSoul = soul ? await r.reg.hasSoul(id, soul.hash) : false;
      agentCtx = { id, agent: a, hasSoul };
      renderAgentBox();
      setMsg($("directMsg"), "", "");
    } catch (e) { setMsg($("directMsg"), "err", errText(e)); }
  }
  function renderAgentBox() {
    const box = $("agentBox");
    box.replaceChildren();
    if (!agentCtx) return;
    const a = agentCtx.agent;
    const mine = wallet.address && a.owner.toLowerCase() === wallet.address.toLowerCase();
    box.append(
      el("p", {}, el("b", { text: "#" + a.id + " " + a.name })),
      el("dl", { class: "kv" },
        el("dt", { text: t("owner") }), el("dd", {}, el("code", { text: a.owner })),
        el("dt", { text: t("headNow") }), el("dd", {}, el("code", { id: "headOut", text: a.headHash === ZERO ? t("headNone") : a.headHash }))),
    );
    if (wallet.address && !mine) box.append(el("p", { class: "err", text: t("notOwner") }));
    if (soul && a.headHash === soul.hash) box.append(el("p", { class: "err", text: t("alreadyHead") }));
    else if (soul && agentCtx.hasSoul) box.append(el("p", { class: "err", text: t("alreadyRecorded") }));
  }
  async function refreshAgentChecks() {
    if (mode === "append" && agentCtx) {
      try { const r = readerReg(); agentCtx.hasSoul = soul ? await r.reg.hasSoul(agentCtx.id, soul.hash) : false; } catch { /* ignore */ }
      renderAgentBox();
    }
  }
  function validateDirect(msgNode) {
    if (!soul) { setMsg(msgNode, "err", t("needSoul")); return false; }
    if (mode === "new") {
      if (!$("dName").value.trim()) { setMsg(msgNode, "err", t("needName")); return false; }
      for (const [id, f] of [["dName", "fName"], ["dAgentNote", "fAgentNote"], ["dMeta", "fMeta"]]) if (over(id)) { setMsg(msgNode, "err", t("tooLong", { field: t(f) })); return false; }
    } else if (!agentCtx) { setMsg(msgNode, "err", t("needAgentId")); return false; }
    if (over("dVersionNote")) { setMsg(msgNode, "err", t("tooLong", { field: t("fVersionNote") })); return false; }
    return true;
  }
  async function feeInfo(gas) {
    const fd = await wallet.bp.getFeeData();
    const price = fd.maxFeePerGas ?? fd.gasPrice ?? 0n;
    return { gas, price, fee: gas * price };
  }
  function signerContract() {
    return wallet.bp.getSigner().then((s) => new ethers.Contract(net.registry, ABI, s));
  }
  async function doEstimate() {
    const out = $("estimateOut");
    setMsg(out, "", "");
    if (!validateDirect(out) || !walletReady(out)) return;
    try {
      const c = await signerContract();
      let gas;
      let second = false;
      if (mode === "new") {
        gas = await c.registerAgent.estimateGas($("dName").value.trim(), $("dAgentNote").value, $("dMeta").value);
        second = $("dWithSoul").checked;
      } else {
        const a = await readerReg().reg.getAgent(agentCtx.id);
        gas = await c.appendSoul.estimateGas(agentCtx.id, soul.hash, a.headHash, $("dVersionNote").value);
      }
      const f = await feeInfo(gas);
      const txt = t("estimateResult", { gas: gas.toString(), gwei: Number(ethers.formatUnits(f.price, "gwei")).toFixed(4), fee: Number(ethers.formatEther(f.fee)).toFixed(8), sym: net.currency.symbol });
      setMsg(out, "ok", txt + (second ? " " + t("estimateSecond") : ""));
    } catch (e) { setMsg(out, "err", t("estimateFail", { msg: errText(e) })); }
  }
  function explorerLink(hash) {
    if (!net.explorer) return el("code", { text: hash });
    return el("span", {}, el("code", { text: short(hash) }), " ", el("a", { href: net.explorer + "/tx/" + hash, target: "_blank", rel: "noopener noreferrer", text: t("viewExplorer") }));
  }
  async function doSendDirect() {
    const msg = $("directMsg");
    const result = $("directResult");
    result.hidden = true;
    setMsg(msg, "", "");
    if (!validateDirect(msg) || !walletReady(msg)) return;
    if (!$("dAck").checked) { setMsg(msg, "err", t("needAck")); return; }
    $("sendDirect").disabled = true;
    try {
      const c = await signerContract();
      const reg = readerReg().reg;
      let agentId, hashes = [];
      if (mode === "new") {
        setMsg(msg, "", t("sending"));
        const tx = await c.registerAgent($("dName").value.trim(), $("dAgentNote").value, $("dMeta").value);
        hashes.push(tx.hash);
        setMsg(msg, "", t("waitingTx", { hash: short(tx.hash) }));
        const rc = await tx.wait();
        for (const log of rc.logs) {
          try { const p = reg.interface.parseLog(log); if (p && p.name === "AgentRegistered") agentId = p.args.agentId; } catch { /* other log */ }
        }
        if ($("dWithSoul").checked) {
          setMsg(msg, "", t("sending"));
          const tx2 = await c.appendSoul(agentId, soul.hash, ZERO, $("dVersionNote").value);
          hashes.push(tx2.hash);
          setMsg(msg, "", t("waitingTx", { hash: short(tx2.hash) }));
          await tx2.wait();
        }
        setMsg(msg, "ok", t("registered", { id: agentId }));
      } else {
        agentId = agentCtx.id;
        const a = await reg.getAgent(agentId); // fresh head right before sending
        if (a.headHash === soul.hash) { setMsg(msg, "err", t("alreadyHead")); return; }
        setMsg(msg, "", t("sending"));
        const tx = await c.appendSoul(agentId, soul.hash, a.headHash, $("dVersionNote").value);
        hashes.push(tx.hash);
        setMsg(msg, "", t("waitingTx", { hash: short(tx.hash) }));
        await tx.wait();
        const fresh = await reg.getAgent(agentId);
        setMsg(msg, "ok", t("appended", { id: agentId, v: fresh.recordCount }));
        agentCtx.agent = fresh;
        renderAgentBox();
      }
      const goBtn = el("button", { type: "button", class: "ghost", text: t("lookupThis") });
      goBtn.addEventListener("click", () => { $("lAgentId").value = String(agentId); selectTab("lookup"); doLookup(); });
      result.replaceChildren(el("p", {}, el("b", { id: "resultAgentId", text: "#" + agentId })), ...hashes.map((h) => el("p", {}, t("txHash") + ": ", explorerLink(h))), goBtn);
      result.hidden = false;
    } catch (e) { setMsg(msg, "err", errText(e)); } finally { $("sendDirect").disabled = false; }
  }

  // ───────────── B: free batched entry ─────────────
  const ENTRY_TYPES = {
    SoulEntry: [
      { name: "owner", type: "address" }, { name: "agentName", type: "string" }, { name: "soulHash", type: "bytes32" },
      { name: "parentHash", type: "bytes32" }, { name: "note", type: "string" }, { name: "signedAt", type: "uint64" },
    ],
  };
  const domainFor = (n) => ({ name: "SoulRegistry", version: "1", chainId: n.chainId, verifyingContract: n.registry });
  // Same formula as SoulRegistry.entryLeaf (see lib/merkle.js)
  function leafOf(domain, entry, sig) {
    const digest = ethers.TypedDataEncoder.hash(domain, ENTRY_TYPES, entry);
    const inner = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["bytes32", "bytes32"], [digest, ethers.keccak256(sig)]));
    return { digest, leaf: ethers.keccak256(inner) };
  }
  async function fetchParent() {
    const msg = $("freeMsg");
    try {
      const r = await ensureContract();
      const a = await r.reg.getAgent(BigInt($("fAgentId").value || "0"));
      $("fParent").value = a.headHash === ZERO ? "0" : a.headHash;
      setMsg(msg, "ok", t("parentFetched"));
    } catch (e) { setMsg(msg, "err", errText(e)); }
  }
  let freeFile = null;
  async function doSign() {
    const msg = $("freeMsg");
    const result = $("freeResult");
    result.hidden = true;
    freeFile = null;
    setMsg(msg, "", "");
    if (!soul) { setMsg(msg, "err", t("needSoul")); return; }
    const name = $("fName").value.trim();
    if (!name) { setMsg(msg, "err", t("needName")); return; }
    if (over("fName")) { setMsg(msg, "err", t("tooLong", { field: t("fName") })); return; }
    if (over("fNote")) { setMsg(msg, "err", t("tooLong", { field: t("fVersionNote") })); return; }
    let parent = $("fParent").value.trim();
    if (parent === "" || parent === "0" || parent === "0x0") parent = ZERO;
    if (!isHash(parent)) { setMsg(msg, "err", t("parentInvalid")); return; }
    if (!walletReady(msg)) return;
    if (!$("fAck").checked) { setMsg(msg, "err", t("needAck")); return; }
    $("signBtn").disabled = true;
    try {
      const signer = await wallet.bp.getSigner();
      const domain = domainFor(net);
      const entry = { owner: wallet.address, agentName: name, soulHash: soul.hash, parentHash: parent, note: $("fNote").value, signedAt: BigInt(Math.floor(Date.now() / 1000)) };
      setMsg(msg, "", t("signing"));
      const signature = await signer.signTypedData(domain, ENTRY_TYPES, entry);
      const signer2 = ethers.verifyTypedData(domain, ENTRY_TYPES, entry, signature);
      if (signer2 !== wallet.address) { setMsg(msg, "err", t("selfCheckBad")); return; }
      const { digest, leaf } = leafOf(domain, entry, signature);
      let digestLine = t("digestSkip");
      try {
        const r = await ensureContract();
        const onchain = await r.reg.entryDigest(entry);
        digestLine = onchain === digest ? t("digestOk") : null;
        if (digestLine === null) { setMsg(msg, "err", "digest mismatch with contract"); return; }
      } catch { /* offline contract: skipped */ }
      freeFile = {
        format: "ieum-ledger-entry", version: 1, network: net.key, chainId: net.chainId, registry: net.registry,
        entry: { owner: entry.owner, agentName: entry.agentName, soulHash: entry.soulHash, parentHash: entry.parentHash, note: entry.note, signedAt: entry.signedAt.toString() },
        signature, digest, leaf,
      };
      const json = JSON.stringify(freeFile, null, 2);
      const fname = `ieum-entry-${soul.hash.slice(2, 10)}-${entry.signedAt}.json`;
      const dl = el("a", { id: "downloadLink", class: "btn", href: URL.createObjectURL(new Blob([json], { type: "application/json" })), download: fname, text: t("downloadBtn") });
      setMsg(msg, "ok", t("signedOk"));
      result.replaceChildren(
        el("p", { class: "ok", text: t("selfCheckOk") }),
        el("p", { class: "ok", text: digestLine }),
        el("p", { class: "good", text: t("freeFee") }),
        el("h4", { text: t("entryPreview") }),
        el("pre", { id: "entryJson" }, el("code", { text: json })),
        dl
      );
      result.hidden = false;
    } catch (e) { setMsg(msg, "err", errText(e)); } finally { $("signBtn").disabled = false; }
  }

  // ───────────── C: lookup + file match ─────────────
  let lookupState = null; // { id, agent, hist, valid, scores }
  async function doLookup() {
    const msg = $("lookupMsg");
    $("lookupOut").replaceChildren();
    lookupState = null;
    setMsg(msg, "", t("loading"));
    try {
      const r = await ensureContract();
      const id = BigInt($("lAgentId").value || "0");
      const agent = await r.reg.getAgent(id);
      const [hist, valid, scores] = await Promise.all([r.reg.getHistory(id), r.reg.verifyChain(id), r.reg.getScores(id)]);
      lookupState = { id, agent, hist, valid, scores };
      setMsg(msg, "", "");
      renderLookup();
    } catch (e) { setMsg(msg, "err", t("lookupFail", { msg: e.shortMessage || e.message })); }
  }
  function renderLookup() {
    const out = $("lookupOut");
    out.replaceChildren();
    if (!lookupState) return;
    const { id, agent: a, hist, valid, scores } = lookupState;
    const matchIdx = soul ? hist.findIndex((r) => r.soulHash === soul.hash) : -1;
    out.append(
      el("h4", { id: "lookupTitleOut", text: t("agentTitle", { id, name: a.name }) }),
      el("p", { text: a.note }),
      el("p", { class: "help" }, t("owner") + " ", el("code", { text: a.owner }), " · " + t("created") + " " + when(a.createdAt)),
      el("p", {}, t("recordCount", { n: a.recordCount }) + " · " + t("chainCheck") + " ", el("b", { id: "chainValid", class: valid ? "ok" : "bad", text: valid ? t("pass") : t("fail") }))
    );
    if (soul) {
      out.append(matchIdx >= 0
        ? el("p", { id: "matchResult", class: "good", text: t("matchYes", { n: matchIdx + 1, head: matchIdx === hist.length - 1 ? t("matchHead") : "" }) })
        : el("p", { id: "matchResult", class: "err", text: t("matchNo") }));
    } else out.append(el("p", { class: "help", text: t("matchNeedFile") }));
    hist.forEach((r, i) => {
      const isMatch = i === matchIdx;
      const head = el("p", {}, el("b", { text: t("version", { n: i + 1 }) }), " ", el("span", { class: "help", text: when(r.timestamp) }));
      if (i === hist.length - 1) head.append(el("span", { class: "badge", text: t("headBadge") }));
      if (isMatch) head.append(el("span", { class: "badge m", text: t("matchBadge") }));
      out.append(el("div", { class: "rec" + (isMatch ? " match" : "") },
        head,
        el("p", { text: r.note }),
        el("p", { class: "help" }, "SHA-256 ", el("code", { text: r.soulHash })),
        el("p", { class: "help" }, t("parent") + " ", el("code", { text: r.parentHash }))));
    });
    if (scores.length) {
      out.append(el("h4", { text: t("scoresTitle") }), el("ul", {}, scores.map((s) => el("li", { text: t("scoreLine", { from: s.fromModel, to: s.toModel, pct: (Number(s.scoreBps) / 100).toFixed(2) }) }))));
    }
  }

  // verify a signed-entry file (+ optional proof/root added by an operator)
  async function verifyEntryFile(file) {
    const out = $("verifyOut");
    out.hidden = false;
    out.replaceChildren();
    const add = (cls, text, id) => out.append(el("p", { class: cls, text, ...(id ? { id } : {}) }));
    let data;
    try { data = JSON.parse(await file.text()); } catch { add("err", t("verifyBadFile")); return; }
    try {
      const e = data.entry;
      if (!e || !data.signature || !ethers.isAddress(e.owner) || typeof e.agentName !== "string" || !isHash(e.soulHash) || !isHash(e.parentHash) || typeof e.note !== "string") throw new Error("shape");
      if (data.chainId !== net.chainId) { add("err", t("verifyWrongNet", { id: data.chainId })); return; }
      const entry = { owner: e.owner, agentName: e.agentName, soulHash: e.soulHash, parentHash: e.parentHash, note: e.note, signedAt: BigInt(e.signedAt) };
      const domain = domainFor(net);
      const rec = ethers.verifyTypedData(domain, ENTRY_TYPES, entry, data.signature);
      const sigOk = rec.toLowerCase() === e.owner.toLowerCase();
      add(sigOk ? "ok" : "err", sigOk ? t("verifySig") : t("verifySigBad"), "verifySigOut");
      out.append(el("p", { class: "help" }, e.agentName + " · ", el("code", { text: e.soulHash })));
      if (soul) add(soul.hash === e.soulHash ? "ok" : "err", soul.hash === e.soulHash ? t("verifyMatchSoul") : t("verifyNotMatchSoul"), "verifySoulOut");
      if (Array.isArray(data.proof) && isHash(data.root || "")) {
        const r = await ensureContract();
        const ok = await r.reg.verifyBatchEntry(entry, data.signature, data.proof, data.root);
        add(ok ? "ok" : "err", ok ? t("verifyBatchOk") : t("verifyBatchBad"), "verifyBatchOut");
      } else add("help", t("verifyNoProof"), "verifyNoProofOut");
    } catch (err) { add("err", t("verifyBadFile")); }
  }

  // ───────────── wiring ─────────────
  function init() {
    if (!NETS.length) { document.body.textContent = t("networkBlocked"); return; }
    $("net").addEventListener("change", (ev) => {
      net = NETS.find((n) => n.key === ev.target.value);
      agentCtx = null; lookupState = null;
      $("agentBox").replaceChildren(); $("lookupOut").replaceChildren(); $("directResult").hidden = true; $("freeResult").hidden = true;
      refreshWalletUi();
    });
    document.querySelectorAll(".seg").forEach((b) => b.addEventListener("click", () => { lang = b.dataset.lang; localStorage.setItem("ieum-lang", lang); applyLang(); }));
    $("soulFile").addEventListener("change", (ev) => { if (ev.target.files[0]) loadFile(ev.target.files[0]); });
    $("soulText").addEventListener("input", (ev) => loadPasted(ev.target.value));
    $("clearSoul").addEventListener("click", () => { $("soulFile").value = ""; $("soulText").value = ""; soul = null; onSoulChanged(); });
    document.querySelectorAll("[role=tab]").forEach((b) => {
      b.addEventListener("click", () => selectTab(b.dataset.tab));
      b.addEventListener("keydown", (ev) => {
        const tabs = [...document.querySelectorAll("[role=tab]")];
        const i = tabs.indexOf(b);
        const j = ev.key === "ArrowRight" ? (i + 1) % tabs.length : ev.key === "ArrowLeft" ? (i + tabs.length - 1) % tabs.length : -1;
        if (j >= 0) { selectTab(tabs[j].dataset.tab); tabs[j].focus(); ev.preventDefault(); }
      });
    });
    $("connect").addEventListener("click", connectWallet);
    $("switchChain").addEventListener("click", switchChain);
    document.querySelectorAll("input[name=mode]").forEach((r) => r.addEventListener("change", () => setMode(r.value)));
    document.querySelectorAll("input[data-limit]").forEach((i) => i.addEventListener("input", updateCounts));
    $("loadAgent").addEventListener("click", loadAgentCtx);
    $("estimate").addEventListener("click", doEstimate);
    $("sendDirect").addEventListener("click", doSendDirect);
    $("fetchParent").addEventListener("click", fetchParent);
    $("signBtn").addEventListener("click", doSign);
    $("lookupBtn").addEventListener("click", doLookup);
    $("entryFile").addEventListener("change", (ev) => { if (ev.target.files[0]) verifyEntryFile(ev.target.files[0]); });
    applyLang();
    selectTab("direct");
    setMode("new");
  }
  init();
})();
