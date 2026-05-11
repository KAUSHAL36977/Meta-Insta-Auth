(function () {
  const $ = (id) => document.getElementById(id);
  const LS_KEY = "metaoauth_lab_config";

  const views = ["dashboard", "setup", "instagram", "webhooks", "reels", "graph"];

  function parseHash() {
    const h = (window.location.hash || "#/dashboard").replace(/^#/, "") || "/dashboard";
    const seg = h.replace(/^\//, "").split("/")[0] || "dashboard";
    return views.includes(seg) ? seg : "dashboard";
  }

  function setHash(route) {
    window.location.hash = `#/${route}`;
  }

  function showView(route) {
    views.forEach((v) => {
      const el = $("view-" + v);
      if (el) el.classList.toggle("hidden", v !== route);
    });
    document.querySelectorAll(".nav-item").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-route") === route);
    });
  }

  function setDot(id, state) {
    const el = $(id);
    if (el) el.setAttribute("data-state", state);
  }

  async function refreshNavStatus() {
    const res = await fetch("/api/lab/status");
    const d = await res.json().catch(() => ({}));
    const setupOk = Boolean(d.setupComplete);
    const igOk = Boolean(d.instagramConnected);
    setDot("dot-setup", setupOk ? "ok" : "err");
    setDot("dot-instagram", igOk ? "ok" : "err");
    setDot("dot-dashboard", setupOk && igOk ? "ok" : setupOk ? "pending" : "err");
    setDot("dot-webhooks", setupOk ? "ok" : "err");
    setDot("dot-reels", igOk ? "ok" : "err");
    setDot("dot-graph", igOk ? "ok" : "err");

    const ds = $("dashSetupSummary");
    if (ds) ds.textContent = setupOk ? "Worker + lab config look ready for OAuth." : "Finish Setup (Meta app ID, secret, redirect, verify token).";
    const di = $("dashIgSummary");
    if (di) di.textContent = igOk ? "Instagram session active." : "Not connected — use Instagram login.";
    return d;
  }

  function readLocal() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  function writeLocal(obj) {
    localStorage.setItem(LS_KEY, JSON.stringify(obj));
  }

  async function fetchDataJson() {
    try {
      const r = await fetch("/data/config.json", { cache: "no-store" });
      if (!r.ok) return {};
      return await r.json();
    } catch {
      return {};
    }
  }

  async function fetchServerLab() {
    const r = await fetch("/api/lab/config");
    if (!r.ok) return {};
    return await r.json();
  }

  function applyFormFromMerged(merged) {
    const set = (id, v) => {
      const el = $(id);
      if (el && typeof v === "string") el.value = v;
    };
    set("fMetaAppId", merged.metaAppId || "");
    set("fInstagramAppId", merged.instagramAppId || "");
    set("fWebhookVerify", merged.webhookVerifyToken || "");
    set("fPublicBase", merged.publicBaseUrl || "");
    $("fMetaAppSecret").value = "";
    $("fInstagramAppSecret").value = "";
  }

  async function loadSetupForm() {
    const local = readLocal();
    const file = await fetchDataJson();
    const server = await fetchServerLab();
    const merged = {
      ...local,
      ...file,
      metaAppId: server.metaAppId || file.metaAppId || local.metaAppId || "",
      instagramAppId: server.instagramAppId || file.instagramAppId || local.instagramAppId || "",
      webhookVerifyToken: server.webhookVerifyToken || file.webhookVerifyToken || local.webhookVerifyToken || "",
      publicBaseUrl: server.publicBaseUrl || file.publicBaseUrl || local.publicBaseUrl || "",
    };
    applyFormFromMerged(merged);

    const hint = $("setupKvHint");
    if (hint) {
      hint.textContent = server.kvEnabled
        ? "KV is enabled: Save writes lab fields to the Worker (META_KV) and overrides bindings for OAuth / webhooks."
        : "No META_KV binding: Save stores secrets in this browser only (localStorage). Deploy with KV for server-side lab config.";
    }
  }

  function showSetupMsg(ok, msg) {
    const e = $("setupBannerError");
    const s = $("setupBannerOk");
    if (!msg) {
      e?.classList.add("hidden");
      s?.classList.add("hidden");
      return;
    }
    if (e) e.classList.toggle("hidden", ok);
    if (s) s.classList.toggle("hidden", !ok);
    if (e && !ok) e.textContent = msg;
    if (s && ok) s.textContent = msg;
  }

  function collectSetupPayload() {
    const o = {
      metaAppId: $("fMetaAppId").value.trim(),
      instagramAppId: $("fInstagramAppId").value.trim(),
      webhookVerifyToken: $("fWebhookVerify").value.trim(),
      publicBaseUrl: $("fPublicBase").value.trim().replace(/\/+$/, ""),
    };
    const ms = $("fMetaAppSecret").value;
    const is = $("fInstagramAppSecret").value;
    if (ms.trim()) o.metaAppSecret = ms.trim();
    if (is.trim()) o.instagramAppSecret = is.trim();
    return o;
  }

  async function saveSetup(ev) {
    ev.preventDefault();
    showSetupMsg(true, "");
    const payload = collectSetupPayload();
    const res = await fetch("/api/lab/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (data.ok === true && data.stored === "kv") {
      showSetupMsg(true, "Saved to Worker KV.");
      await loadSetupForm();
    } else {
      const prev = readLocal();
      const next = { ...prev, ...payload };
      if (!payload.metaAppSecret && prev.metaAppSecret) next.metaAppSecret = prev.metaAppSecret;
      if (!payload.instagramAppSecret && prev.instagramAppSecret) next.instagramAppSecret = prev.instagramAppSecret;
      writeLocal(next);
      showSetupMsg(true, data.message || "Saved in this browser (localStorage). Add META_KV for server-side storage.");
    }
    await refreshNavStatus();
  }

  function originBase() {
    return `${window.location.protocol}//${window.location.host}`;
  }

  function initWebhooksView() {
    const cb = $("whCallback");
    if (cb) cb.textContent = `${originBase()}/api/webhook/meta`;
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      prompt("Copy:", text);
    }
  }

  /* ——— Instagram + status ——— */
  function showIgError(msg) {
    const el = $("bannerError");
    if (!el) return;
    el.textContent = msg;
    el.classList.remove("hidden");
  }

  function clearIgError() {
    $("bannerError")?.classList.add("hidden");
  }

  function showReelsError(msg) {
    const el = $("reelsBannerError");
    if (!el) return;
    el.textContent = msg;
    el.classList.remove("hidden");
  }

  function clearReelsError() {
    $("reelsBannerError")?.classList.add("hidden");
  }

  function fmtNum(n) {
    if (n === null || n === undefined) return "—";
    return Number(n).toLocaleString();
  }

  async function loadAuthStatus() {
    clearIgError();
    const res = await fetch("/api/auth/status");
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showIgError(data.error || "Status request failed");
      return data;
    }
    if (data.configError) showIgError(data.configError);
    if (data.graphVersion) {
      const g = $("graphVersionFooter");
      if (g) g.textContent = data.graphVersion;
    }

    const connect = $("btnConnect");
    const sw = $("btnSwitch");
    const disc = $("btnDisconnect");
    const meta = $("accountMeta");
    const bc = $("bannerConnected");

    if (data.connected) {
      connect?.classList.add("hidden");
      meta?.classList.remove("hidden");
      sw?.classList.remove("hidden");
      disc?.classList.remove("hidden");
      bc?.classList.remove("hidden");
      const h = $("handleDisplay");
      if (h) h.textContent = "@" + (data.igUsername || "connected");
      const t = $("accountTypeDisplay");
      if (t) t.textContent = data.accountType || "MEDIA_CREATOR";
    } else {
      connect?.classList.remove("hidden");
      meta?.classList.add("hidden");
      sw?.classList.add("hidden");
      disc?.classList.add("hidden");
      bc?.classList.add("hidden");
    }

    const wh = $("webhookHint");
    if (data.lastWebhook && data.lastWebhook.at) {
      wh?.classList.remove("hidden");
      const summary = data.lastWebhook.summary ? ` · ${data.lastWebhook.summary}` : "";
      if (wh) wh.textContent = `Last webhook: ${new Date(data.lastWebhook.at).toLocaleString()}${summary}.`;
    } else {
      wh?.classList.add("hidden");
    }
    return data;
  }

  function readQueryError() {
    const params = new URLSearchParams(window.location.search);
    const err = params.get("error");
    if (err) showIgError(decodeURIComponent(err.replace(/\+/g, " ")));
    if (err) {
      const u = new URL(window.location.href);
      u.searchParams.delete("error");
      window.history.replaceState({}, "", u.pathname + u.search + window.location.hash);
    }
  }

  async function fetchReelMetrics() {
    clearReelsError();
    const url = $("reelUrl").value.trim();
    if (!url) {
      showReelsError("Enter a Reel URL.");
      return;
    }
    $("btnFetch").disabled = true;
    try {
      const res = await fetch("/api/reels/insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showReelsError(data.error || "Request failed");
        return;
      }
      const p = data.preview;
      const m = data.metrics;
      $("previewCard")?.classList.remove("hidden");
      $("metricsSection")?.classList.remove("hidden");
      const type = (p.mediaType || "REELS").toUpperCase();
      $("mediaTypePill").textContent = type === "VIDEO" ? "REELS" : type;
      $("previewPermalink").textContent = p.permalink || "";
      $("previewCaption").textContent = p.caption || "";
      $("previewPosted").textContent = p.timestamp ? "Posted " + new Date(p.timestamp).toLocaleString() : "";
      if (p.thumbnailUrl) {
        $("thumbImg").src = p.thumbnailUrl;
        $("thumbImg").classList.remove("hidden");
        $("thumbPlaceholder").classList.add("hidden");
      } else {
        $("thumbImg").removeAttribute("src");
        $("thumbImg").classList.add("hidden");
        $("thumbPlaceholder").classList.remove("hidden");
      }
      $("mLikes").textContent = fmtNum(m.likes);
      $("mComments").textContent = fmtNum(m.comments);
      $("mViews").textContent = fmtNum(m.views);
      $("mReach").textContent = fmtNum(m.reach);
      $("mSaves").textContent = fmtNum(m.saves);
      $("mShares").textContent = fmtNum(m.shares);
      $("mTotal").textContent = fmtNum(m.totalInteractions);
      $("mAvgWatch").textContent = fmtNum(m.avgWatchTimeMs);
      $("mTotalWatch").textContent = fmtNum(m.totalWatchTimeMs);
    } finally {
      $("btnFetch").disabled = false;
    }
  }

  async function runGraph() {
    const path = $("graphPath").value.trim() || "/me";
    const res = await fetch("/api/lab/graph", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
    const data = await res.json().catch(() => ({}));
    $("graphOut").textContent = JSON.stringify(data, null, 2);
  }

  function route() {
    const r = parseHash();
    showView(r);
    if (r === "webhooks") initWebhooksView();
    if (r === "setup") loadSetupForm();
  }

  document.querySelectorAll("[data-route]").forEach((el) => {
    el.addEventListener("click", () => {
      const r = el.getAttribute("data-route");
      if (r) setHash(r);
    });
  });

  $("setupForm")?.addEventListener("submit", saveSetup);
  $("btnReloadConfigFiles")?.addEventListener("click", () => loadSetupForm());

  $("btnConnect")?.addEventListener("click", () => {
    window.location.href = "/api/auth/meta/start";
  });
  $("btnSwitch")?.addEventListener("click", () => {
    window.location.href = "/api/auth/meta/switch";
  });
  $("btnDisconnect")?.addEventListener("click", async () => {
    await fetch("/api/auth/disconnect", { method: "POST" });
    $("previewCard")?.classList.add("hidden");
    $("metricsSection")?.classList.add("hidden");
    await loadAuthStatus();
    await refreshNavStatus();
  });
  $("btnFetch")?.addEventListener("click", fetchReelMetrics);
  $("btnGraphRun")?.addEventListener("click", runGraph);
  $("btnCopyCallback")?.addEventListener("click", () => copyText($("whCallback").textContent));

  window.addEventListener("hashchange", route);

  readQueryError();
  route();
  loadAuthStatus();
  refreshNavStatus();
  initWebhooksView();
  setInterval(() => {
    loadAuthStatus();
    refreshNavStatus();
  }, 12000);
})();
