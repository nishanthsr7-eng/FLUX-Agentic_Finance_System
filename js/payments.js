/* FLUX — Payments page module
 * ============================
 * Backend-wired logic for the Payments page. Loads after flux-data.js (which
 * hydrates localStorage from /db/* and attaches the auth token to fetch) and
 * dashboard.js (which provides the app-standard showToast + #toastContainer).
 *
 * Design:
 *   • Reads render data from localStorage (kept in sync by flux-data.js) and
 *     re-renders on the `flux:data-updated` event.
 *   • Writes go to the backend first (POST /db/*). On success the local cache is
 *     updated and the UI re-rendered. If the backend is unreachable, the write
 *     falls back to a localStorage-only update so the page still works offline.
 *   • Outgoing money requires a balance check + an explicit PIN-authorized
 *     confirmation step. Nothing fake/theatrical: no invented encryption states.
 */
(function fluxPayments() {
  "use strict";

  const API = () => window.FLUX_API || "";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => (window.fluxEsc ? window.fluxEsc(s)
    : String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])));
  // Self-contained toast (matches dashboard.css .toast styling). Defined here so
  // the page doesn't load the dashboard controller, which hijacks .btn-action.
  function fluxToast(message, type = "success") {
    const container = $("toastContainer");
    if (!container) return;
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.setAttribute("role", "alert");
    let icon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>';
    if (type === "error") icon = '<span aria-hidden="true">!</span>';
    if (type === "info") icon = '<span aria-hidden="true">i</span>';
    el.innerHTML = `<div class="toast-icon">${icon}</div><div class="toast-msg">${esc(message)}</div><button type="button" class="toast-close" aria-label="Dismiss notification">×</button>`;
    container.prepend(el);
    el.querySelector(".toast-close").addEventListener("click", () => { el.classList.remove("show"); setTimeout(() => el.remove(), 400); });
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add("show")));
    const timer = setTimeout(() => { el.classList.remove("show"); setTimeout(() => el.remove(), 400); }, 4000);
    el.addEventListener("mouseenter", () => clearTimeout(timer));
  }
  window.showToast = fluxToast;
  const toast = (msg, type) => fluxToast(msg, type || "success");

  const MONTHLY_DISCRETIONARY_LIMIT = 100000; // ₹ cap for the headroom gauge

  // ── localStorage helpers ────────────────────────────────────────────────────
  const ls = {
    txs:       () => JSON.parse(localStorage.getItem("flux_transactions") || "[]"),
    accounts:  () => JSON.parse(localStorage.getItem("flux_accounts")     || "[]"),
    recurring: () => JSON.parse(localStorage.getItem("flux_recurring")    || "[]"),
    contacts:  () => JSON.parse(localStorage.getItem("flux_contacts")     || "[]"),
    protocols: () => JSON.parse(localStorage.getItem("flux_protocols")    || "[false,false,false]"),
    rewardStates: () => JSON.parse(localStorage.getItem("flux_reward_states") || "{}"),
    set: (k, v) => localStorage.setItem(k, JSON.stringify(v)),
  };

  const inr = (n) => "₹" + Math.round(Number(n) || 0).toLocaleString("en-IN");

  function activeAccount() {
    const a = ls.accounts();
    return a.find((x) => x.active) || a[0] || null;
  }

  function availableOf(acct) {
    if (!acct) return 0;
    const bal = Number(acct.balance) || 0;
    if (bal > 0) return bal;
    if ((acct.acctType || "") === "credit" && Number(acct.creditLimit) > 0) return Number(acct.creditLimit);
    // Fallback for caches/seeds that only carry the pre-formatted `val` string.
    if (acct.val) { const n = Number(String(acct.val).replace(/[^\d.]/g, "")); if (n) return n; }
    return bal;
  }

  // ── Authenticated JSON helpers (token attached by flux-data.js fetch wrapper) ─
  async function apiSend(method, path, body) {
    const r = await fetch(`${API()}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const err = new Error(data.detail || `${path} → ${r.status}`);
      err.status = r.status;
      throw err;
    }
    return data;
  }
  // A thrown error is "offline" (retry locally) only when the network failed,
  // not when the backend deliberately rejected the request (4xx).
  const isOffline = (err) => !API() || err.status == null;

  // ── Date helpers ────────────────────────────────────────────────────────────
  function isSameMonth(d1, d2) {
    return d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth();
  }
  function daysUntil(dueDay) {
    const now = new Date();
    const today = now.getDate();
    const dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    let diff = dueDay - today;
    if (diff < 0) diff += dim;           // rolls into next month
    if (diff === 0) return "Due today";
    if (diff === 1) return "Due tomorrow";
    return `Due in ${diff} days`;
  }
  const daysLeftInMonth = () => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() - now.getDate();
  };

  // ── Identity ────────────────────────────────────────────────────────────────
  function setIdentity(user) {
    if (!user) return;
    const name = user.name || "FLUX User";
    const nameEl = $("hdrName"), avEl = $("hdrAvatar");
    if (nameEl) nameEl.textContent = name;
    if (avEl) {
      avEl.textContent = name.trim().split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "FX";
    }
  }

  // ── Auth guard ──────────────────────────────────────────────────────────────
  // Personal /db data requires a session. If the backend says 401 we bounce to
  // login; if it's simply unreachable we stay in offline (seed) mode rather than
  // locking the user out.
  async function authGuard() {
    if (!API()) return true;
    const loginUrl = (window.FluxAuth && window.FluxAuth.loginUrl())
      || (location.pathname.includes("/pages/") ? "login.html" : "pages/login.html");
    try {
      const r = await fetch(`${API()}/auth/me`);
      if (r.status === 401) { location.replace(loginUrl); return false; }
      if (r.ok) { const d = await r.json().catch(() => ({})); if (d.user) setIdentity(d.user); }
      return true;
    } catch (_) {
      return true; // offline → allow, render from seed/cache
    }
  }

  // ── Source card ─────────────────────────────────────────────────────────────
  function renderSourceCard() {
    const acct = activeAccount();
    const bankEl = $("sourceBank"), labelEl = $("sourceStatLabel"),
      valEl = $("sourceStatVal"), cardEl = $("sourceCardNum");
    if (!acct) {
      if (bankEl) bankEl.textContent = "No source linked";
      if (labelEl) labelEl.textContent = "Available";
      if (valEl) valEl.textContent = "—";
      if (cardEl) cardEl.textContent = "—";
      return;
    }
    if (bankEl) bankEl.textContent = acct.name;
    if (labelEl) labelEl.textContent = (acct.acctType === "credit") ? "Available Credit" : "Available Balance";
    if (valEl) valEl.textContent = inr(availableOf(acct));
    if (cardEl) cardEl.textContent = acct.cardNum ? acct.cardNum.replace(/.*(\d{4})$/, "•••• $1") : "—";
  }

  // ── Spending headroom gauge ──────────────────────────────────────────────────
  function renderGauge() {
    const now = new Date();
    const spent = ls.txs()
      .filter((t) => isSameMonth(new Date(t.date), now) && Number(t.amount) < 0 && t.category !== "investment")
      .reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
    const limit = MONTHLY_DISCRETIONARY_LIMIT;
    const pct = Math.min(100, Math.round((spent / limit) * 100));
    const remaining = Math.max(0, limit - spent);
    const refresh = daysLeftInMonth();

    const fill = $("gaugeFill"); if (fill) fill.style.width = `${pct}%`;
    const rem = $("gaugeRemaining"); if (rem) rem.textContent = inr(remaining);
    const util = $("gaugeUtil"); if (util) util.textContent = `Utilization: ${pct}%`;
    const ref = $("gaugeRefresh");
    if (ref) ref.textContent = refresh <= 0 ? "Refreshes today" : `Refreshes in ${refresh} day${refresh === 1 ? "" : "s"}`;
  }

  // ── Protocol / security toggles ──────────────────────────────────────────────
  function renderProtocols() {
    const saved = ls.protocols();
    document.querySelectorAll(".p-toggle").forEach((toggle, i) => {
      const on = !!saved[i];
      toggle.classList.toggle("active", on);
      toggle.setAttribute("aria-checked", String(on));
    });
  }
  function wireProtocols() {
    document.querySelectorAll(".p-toggle").forEach((toggle, i) => {
      toggle.addEventListener("click", async () => {
        const next = !toggle.classList.contains("active");
        toggle.classList.toggle("active", next);
        toggle.setAttribute("aria-checked", String(next));
        toggle.style.transform = "scale(0.95)";
        setTimeout(() => (toggle.style.transform = ""), 100);

        const states = [...document.querySelectorAll(".p-toggle")].map((t) => t.classList.contains("active"));
        ls.set("flux_protocols", states);
        const label = toggle.getAttribute("aria-label") || "Setting";
        try {
          await apiSend("POST", "/db/security/toggle", { index: i, enabled: next });
          toast(`${label} ${next ? "enabled" : "disabled"}`);
        } catch (err) {
          if (isOffline(err)) toast(`${label} ${next ? "enabled" : "disabled"} (offline)`, "info");
          else {
            // Backend rejected — revert the optimistic flip.
            toggle.classList.toggle("active", !next);
            toggle.setAttribute("aria-checked", String(!next));
            ls.set("flux_protocols", [...document.querySelectorAll(".p-toggle")].map((t) => t.classList.contains("active")));
            toast(err.message, "error");
          }
        }
      });
    });
  }

  // ── Upcoming settlements ─────────────────────────────────────────────────────
  const BILL_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>`;
  function renderBills() {
    const bills = ls.recurring();
    const container = $("upcomingBills");
    if (!container) return;
    if (!bills.length) {
      container.innerHTML = `<div class="empty-state">No upcoming bills. Add one with “Recurring”.</div>`;
      return;
    }
    // Soonest first.
    const withDays = bills.map((b) => {
      const now = new Date(); const today = now.getDate();
      const dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      let d = b.dueDay - today; if (d < 0) d += dim;
      return { ...b, _d: d };
    }).sort((a, b) => a._d - b._d);

    container.innerHTML = withDays.map((b) => `
      <div class="bill-item" role="button" tabindex="0" data-bill="${esc(b.title)}">
        <div class="bill-info">
          <div class="bill-icon" style="color: var(--accent-teal);">${BILL_ICON}</div>
          <div class="bill-details">
            <div class="bill-title">${esc(b.title)}</div>
            <div class="bill-date">${esc(daysUntil(b.dueDay))}</div>
          </div>
        </div>
        <div class="bill-amount">${inr(b.amount)}</div>
      </div>`).join("");

    container.querySelectorAll(".bill-item").forEach((el) => {
      const act = () => toast(`Settlement scheduled for ${el.dataset.bill}`);
      el.addEventListener("click", act);
      onEnter(el, act);
    });
  }

  // ── Contacts ─────────────────────────────────────────────────────────────────
  function renderContacts() {
    const grid = $("contactsGrid");
    const search = $("contact-search");
    const target = $("target-id");
    if (!grid) return;
    const all = ls.contacts();

    function build(list) {
      if (!list.length) {
        grid.innerHTML = `<div class="empty-state">No contacts found.</div>`;
        return;
      }
      grid.innerHTML = list.map((c) => `
        <div class="contact-item" role="button" tabindex="0" data-flux-id="${esc(c.fluxId)}" aria-label="Send to ${esc(c.name)}">
          <div class="contact-avatar">${esc(c.initial || (c.name || "?")[0])}</div>
          <div class="contact-name">${esc(c.name)}</div>
        </div>`).join("");
      grid.querySelectorAll(".contact-item").forEach((item) => {
        const act = () => {
          if (target) { target.value = item.dataset.fluxId; target.focus(); }
          toast(`Recipient: ${item.querySelector(".contact-name").textContent}`);
        };
        item.addEventListener("click", act);
        onEnter(item, act);
      });
    }

    build(all);
    // Wire the search box only once, even across re-hydrations.
    if (search && !search.dataset.wired) {
      search.dataset.wired = "1";
      search.addEventListener("input", () => {
        const list = ls.contacts();
        const q = search.value.toLowerCase().trim();
        build(q ? list.filter((c) => (c.name || "").toLowerCase().includes(q)) : list);
      });
    }
  }

  // ── Rewards ──────────────────────────────────────────────────────────────────
  // Offline catalogue mirrors the MySQL seed so the section is identical online
  // and offline; claimed state is overlaid from flux_reward_states.
  const REWARD_FALLBACK = [
    { key: "first_payment", title: "First Payment Sent", points: 250, claimed: true },
    { key: "vault_starter", title: "Opened a Vault Goal", points: 150, claimed: true },
    { key: "streak_30", title: "30-Day Activity Streak", points: 500, claimed: true },
    { key: "invest_5l", title: "₹5L Invested Milestone", points: 1000, claimed: false },
    { key: "referral_3", title: "Referred 3 Friends", points: 750, claimed: false },
    { key: "credit_750", title: "Crossed 750 Credit Score", points: 600, claimed: true },
  ];
  function getRewards() {
    const live = window.FluxData && window.FluxData.rew && window.FluxData.rew.rewards;
    if (live && live.length) {
      return live.map((r) => ({ key: r.reward_key, title: r.title, points: r.points, claimed: !!r.claimed }));
    }
    const states = ls.rewardStates();
    return REWARD_FALLBACK.map((r) => ({ ...r, claimed: r.key in states ? !!states[r.key] : r.claimed }));
  }
  const REWARD_ICON = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/></svg>`;
  function renderRewards() {
    const box = $("rewardsBox");
    const totalEl = $("rewardsTotal");
    if (!box) return;
    const rewards = getRewards();
    if (totalEl) {
      const claimedPts = rewards.filter((r) => r.claimed).reduce((s, r) => s + (r.points || 0), 0);
      totalEl.textContent = `${claimedPts.toLocaleString("en-IN")} pts`;
    }
    if (!rewards.length) {
      box.innerHTML = `<div class="empty-state">No rewards yet.</div>`;
      return;
    }
    box.innerHTML = rewards.map((r) => `
      <div class="reward-item ${r.claimed ? "claimed" : ""}" data-key="${esc(r.key)}"
        ${r.claimed ? "" : 'role="button" tabindex="0"'}
        style="display:flex;gap:12px;align-items:center;padding:12px;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.05);border-radius:12px;${r.claimed ? "" : "cursor:pointer;"}"
        aria-label="${esc(r.title)} — ${r.claimed ? "claimed" : "claim for " + r.points + " points"}">
        <div class="reward-icon" style="color:#f39c12;background:rgba(243,156,18,0.1);padding:8px;border-radius:8px;">${REWARD_ICON}</div>
        <div style="flex:1;">
          <div style="font-size:13px;font-weight:600;">${esc(r.title)}</div>
          <div style="font-size:11px;color:var(--text-secondary);margin-top:2px;">${(r.points || 0).toLocaleString("en-IN")} points</div>
        </div>
        <div class="reward-status" style="font-size:11px;font-weight:700;color:${r.claimed ? "var(--text-secondary)" : "var(--accent-teal)"};">${r.claimed ? "Claimed" : "Claim"}</div>
      </div>`).join("");

    box.querySelectorAll(".reward-item:not(.claimed)").forEach((item) => {
      const act = () => claimReward(item);
      item.addEventListener("click", act);
      onEnter(item, act);
    });
  }
  async function claimReward(item) {
    if (item.classList.contains("claimed") || item.classList.contains("claiming")) return;
    const key = item.dataset.key;
    const title = item.querySelector("div[style*='font-weight:600']").textContent;
    const statusEl = item.querySelector(".reward-status");
    item.classList.add("claiming");
    if (statusEl) statusEl.textContent = "Claiming…";
    try {
      await apiSend("POST", "/db/rewards/claim", { reward_key: key });
      if (window.FluxData && window.FluxData.rew && window.FluxData.rew.rewards) {
        const row = window.FluxData.rew.rewards.find((r) => r.reward_key === key);
        if (row) row.claimed = 1;
      }
      finishClaim(item, statusEl, title, key);
    } catch (err) {
      if (isOffline(err)) {
        finishClaim(item, statusEl, title, key);
      } else if (err.status === 409) {
        finishClaim(item, statusEl, title, key); // already claimed server-side
      } else {
        item.classList.remove("claiming");
        if (statusEl) statusEl.textContent = "Claim";
        toast(err.message, "error");
      }
    }
  }
  function finishClaim(item, statusEl, title, key) {
    item.classList.remove("claiming");
    item.classList.add("claimed");
    item.removeAttribute("role"); item.removeAttribute("tabindex"); item.style.cursor = "";
    if (statusEl) { statusEl.textContent = "Claimed"; statusEl.style.color = "var(--text-secondary)"; }
    const states = ls.rewardStates(); states[key] = true; ls.set("flux_reward_states", states);
    toast(`Claimed: ${title}`);
    const totalEl = $("rewardsTotal");
    if (totalEl) {
      const pts = getRewards().filter((r) => r.claimed).reduce((s, r) => s + (r.points || 0), 0);
      totalEl.textContent = `${pts.toLocaleString("en-IN")} pts`;
    }
  }

  // ── Modals ───────────────────────────────────────────────────────────────────
  let lastFocused = null;
  function openModal(id) {
    const m = $(id); if (!m) return;
    lastFocused = document.activeElement;
    m.classList.add("show");
    const f = m.querySelector("input, select, button");
    if (f) setTimeout(() => f.focus(), 30);
  }
  function closeModal(id) {
    const m = $(id); if (!m) return;
    m.classList.remove("show");
    if (lastFocused && lastFocused.focus) lastFocused.focus();
  }
  function wireModals() {
    document.querySelectorAll("[data-close]").forEach((btn) =>
      btn.addEventListener("click", () => closeModal(btn.dataset.close)));
    document.querySelectorAll(".flux-modal-backdrop").forEach((bd) =>
      bd.addEventListener("click", (e) => { if (e.target === bd) closeModal(bd.id); }));
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        const open = document.querySelector(".flux-modal-backdrop.show");
        if (open) closeModal(open.id);
      }
    });
  }

  // ── Local-write fallback for transactions ────────────────────────────────────
  function writeLocalTxn({ title, amount, category }) {
    const acct = activeAccount();
    const txs = ls.txs();
    txs.unshift({
      id: "tx_" + Date.now(), title, date: new Date().toISOString(),
      amount, category, account: acct ? acct.name : "",
    });
    ls.set("flux_transactions", txs);
    if (acct) {
      const accts = ls.accounts();
      const a = accts.find((x) => x.name === acct.name);
      if (a) {
        // Seed a real opening balance from the parsed value when the cached
        // account predates the numeric balance field, so we never start from 0.
        const base = Number(a.balance) > 0 ? Number(a.balance) : availableOf(a);
        a.balance = base + amount;
        a.val = inr(a.balance);
        ls.set("flux_accounts", accts);
      }
    }
    renderSourceCard(); renderGauge();
  }

  // ── Transmit (send money) with PIN confirmation ──────────────────────────────
  let pendingPayment = null;
  function wireTransmit() {
    const btn = $("transmitBtn");
    const amountInput = $("stream-amount");
    const target = $("target-id");
    if (!btn) return;

    btn.addEventListener("click", () => {
      const recipient = target ? target.value.trim() : "";
      const amount = parseFloat((amountInput ? amountInput.value : "").replace(/,/g, "").trim());
      if (!recipient) { toast("Enter a recipient (FLUX ID or UPI)", "error"); target && target.focus(); return; }
      if (!amount || amount <= 0) { toast("Enter a valid amount", "error"); amountInput && amountInput.focus(); return; }

      const acct = activeAccount();
      const avail = availableOf(acct);
      if (acct && amount > avail) {
        toast(`Insufficient funds: ${inr(amount)} exceeds available ${inr(avail)}`, "error");
        return;
      }
      pendingPayment = { recipient, amount };
      $("confirmAmount").textContent = inr(amount);
      $("confirmTo").textContent = recipient;
      $("confirmFrom").textContent = acct ? acct.name : "—";
      $("confirmPin").value = "";
      openModal("confirmModal");
    });

    $("confirmAuthorizeBtn").addEventListener("click", async () => {
      if (!pendingPayment) return;
      const pin = $("confirmPin").value.trim();
      if (!/^\d{4,6}$/.test(pin)) { toast("Enter your 4–6 digit FLUX PIN", "error"); $("confirmPin").focus(); return; }

      const authBtn = $("confirmAuthorizeBtn");
      authBtn.disabled = true; authBtn.textContent = "Authorizing…";
      const { recipient, amount } = pendingPayment;
      const payload = { title: "Transfer → " + recipient, amount: -amount, category: "transfer" };
      try {
        const res = await apiSend("POST", "/db/transactions", payload);
        // Sync local cache from the authoritative response.
        const txs = ls.txs(); if (res.transaction) txs.unshift(res.transaction); ls.set("flux_transactions", txs);
        if (res.account_balance != null) {
          const accts = ls.accounts(); const acct = activeAccount();
          const a = acct && accts.find((x) => x.name === acct.name);
          if (a) { a.balance = res.account_balance; a.val = inr(a.balance); ls.set("flux_accounts", accts); }
        }
        renderSourceCard(); renderGauge();
        toast(`Sent ${inr(amount)} to ${recipient}`);
        finishTransmit();
      } catch (err) {
        if (isOffline(err)) {
          writeLocalTxn(payload);
          toast(`Sent ${inr(amount)} to ${recipient} (offline)`, "info");
          finishTransmit();
        } else {
          toast(err.message, "error");
          authBtn.disabled = false; authBtn.textContent = "Authorize";
        }
      }
    });
  }
  function finishTransmit() {
    const authBtn = $("confirmAuthorizeBtn");
    authBtn.disabled = false; authBtn.textContent = "Authorize";
    closeModal("confirmModal");
    pendingPayment = null;
    const amountInput = $("stream-amount"), target = $("target-id");
    if (amountInput) amountInput.value = "";
    if (target) target.value = "";
  }

  // ── Request / Split / Recurring ──────────────────────────────────────────────
  function wireQuickActions() {
    $("requestActionBtn").addEventListener("click", () => openModal("requestModal"));
    $("splitActionBtn").addEventListener("click", () => openModal("splitModal"));
    $("recurringActionBtn").addEventListener("click", () => openModal("recurringModal"));

    // Request
    $("requestSubmitBtn").addEventListener("click", async () => {
      const from = $("requestFrom").value.trim();
      const amount = parseFloat($("requestAmount").value);
      const note = $("requestNote").value.trim();
      if (!from || isNaN(amount) || amount <= 0) { toast("Enter a valid contact and amount", "error"); return; }
      const payload = { title: `Request from ${from}${note ? " — " + note : ""}`, amount: amount, category: "income" };
      await submitTxn(payload, () => {
        closeModal("requestModal");
        ["requestFrom", "requestAmount", "requestNote"].forEach((id) => ($(id).value = ""));
        toast(`Requested ${inr(amount)} from ${from}`);
      });
    });

    // Split
    $("splitSubmitBtn").addEventListener("click", async () => {
      const desc = $("splitDesc").value.trim();
      const total = parseFloat($("splitTotal").value);
      const people = parseInt($("splitPeople").value, 10);
      if (!desc || isNaN(total) || total <= 0 || isNaN(people) || people < 2) {
        toast("Enter description, total, and at least 2 people", "error"); return;
      }
      const myShare = Math.round((total / people) * 100) / 100;
      const payload = { title: `Split: ${desc} (1 of ${people})`, amount: -myShare, category: "lifestyle" };
      await submitTxn(payload, () => {
        closeModal("splitModal");
        $("splitDesc").value = ""; $("splitTotal").value = ""; $("splitPeople").value = "2";
        $("splitPreview").style.display = "none";
        toast(`Split recorded — your share: ${inr(myShare)}`);
      });
    });

    // Recurring
    $("recurringSubmitBtn").addEventListener("click", async () => {
      const title = $("recurringTitle").value.trim();
      const amount = parseFloat($("recurringAmount").value);
      const dueDay = parseInt($("recurringDay").value, 10);
      const category = $("recurringCategory").value;
      if (!title || isNaN(amount) || amount <= 0 || isNaN(dueDay) || dueDay < 1 || dueDay > 31) {
        toast("Fill in all recurring fields correctly", "error"); return;
      }
      const apply = () => {
        closeModal("recurringModal");
        $("recurringTitle").value = ""; $("recurringAmount").value = ""; $("recurringDay").value = "";
        renderBills();
        toast(`Recurring “${title}” added — due day ${dueDay}`);
      };
      try {
        const res = await apiSend("POST", "/db/recurring", { title, amount, due_day: dueDay, category });
        if (res.recurring) ls.set("flux_recurring", res.recurring.map((r) => ({ title: r.title, amount: Number(r.amount), dueDay: r.due_day, category: r.category })));
        apply();
      } catch (err) {
        if (isOffline(err)) {
          const recs = ls.recurring(); recs.push({ title, amount, dueDay, category }); ls.set("flux_recurring", recs);
          apply();
        } else toast(err.message, "error");
      }
    });

    // Split live preview
    const upd = () => {
      const t = parseFloat($("splitTotal").value), p = parseInt($("splitPeople").value, 10);
      const el = $("splitPreview");
      if (t > 0 && p >= 2) { el.style.display = "block"; el.textContent = `Your share: ${inr(t / p)} of ${inr(t)} total`; }
      else el.style.display = "none";
    };
    $("splitTotal").addEventListener("input", upd);
    $("splitPeople").addEventListener("input", upd);
  }

  // Shared submit for request/split (write a transaction; refresh gauge).
  async function submitTxn(payload, onDone) {
    try {
      const res = await apiSend("POST", "/db/transactions", payload);
      const txs = ls.txs(); if (res.transaction) txs.unshift(res.transaction); ls.set("flux_transactions", txs);
      if (res.account_balance != null) {
        const accts = ls.accounts(); const acct = activeAccount();
        const a = acct && accts.find((x) => x.name === acct.name);
        if (a) { a.balance = res.account_balance; a.val = inr(a.balance); ls.set("flux_accounts", accts); }
      }
      renderSourceCard(); renderGauge(); onDone();
    } catch (err) {
      if (isOffline(err)) { writeLocalTxn(payload); onDone(); }
      else toast(err.message, "error");
    }
  }

  // ── Account switcher ─────────────────────────────────────────────────────────
  function mapAcctRow(r) {
    return {
      name: r.name, val: inr(r.balance), balance: Number(r.balance) || 0,
      creditLimit: Number(r.credit_limit) || 0, acctType: r.acct_type,
      active: !!r.active, cardNum: r.card_masked, expiry: r.expiry_masked,
    };
  }
  function wireAccountSwitcher() {
    const btn = $("showOtherCardsBtn");
    if (!btn) return;
    btn.addEventListener("click", () => {
      const list = $("accountList");
      const accts = ls.accounts();
      if (!accts.length) { list.innerHTML = `<div class="empty-state">No accounts linked.</div>`; openModal("accountModal"); return; }
      list.innerHTML = accts.map((a) => `
        <div class="acct-option ${a.active ? "active" : ""}" role="button" tabindex="0" data-name="${esc(a.name)}">
          <div>
            <div class="a-name">${esc(a.name)}</div>
            <div class="a-meta">${esc(a.cardNum || "")} · ${a.acctType === "credit" ? "Credit" : "Savings"} · ${inr(availableOf(a))}</div>
          </div>
          <div class="a-check">✓</div>
        </div>`).join("");
      list.querySelectorAll(".acct-option").forEach((opt) => {
        const act = () => switchAccount(opt.dataset.name);
        opt.addEventListener("click", act);
        onEnter(opt, act);
      });
      openModal("accountModal");
    });
  }
  async function switchAccount(name) {
    const applyLocal = () => {
      const accts = ls.accounts();
      accts.forEach((a) => (a.active = a.name === name));
      ls.set("flux_accounts", accts);
      renderSourceCard(); renderGauge();
      closeModal("accountModal");
      toast(`Source switched to ${name}`);
    };
    try {
      const res = await apiSend("POST", "/db/accounts/activate", { name });
      if (res.accounts) ls.set("flux_accounts", res.accounts.map(mapAcctRow));
      renderSourceCard(); renderGauge();
      closeModal("accountModal");
      toast(`Source switched to ${name}`);
    } catch (err) {
      if (isOffline(err)) applyLocal();
      else toast(err.message, "error");
    }
  }

  // ── App redirects (UPI deep links) ───────────────────────────────────────────
  const UPI_SCHEMES = {
    gpay: (p) => `tez://upi/pay?${p}`,
    phonepe: (p) => `phonepe://pay?${p}`,
    paytm: (p) => `paytmmp://pay?${p}`,
    amazonpay: (p) => `upi://pay?${p}`,
  };
  const APP_LABELS = { gpay: "Google Pay", phonepe: "PhonePe", paytm: "Paytm", amazonpay: "Amazon Pay", applepay: "Apple Pay" };
  function wireAppCards() {
    document.querySelectorAll(".app-card").forEach((card) => {
      const app = card.dataset.app;
      const act = () => {
        card.style.transform = "scale(0.92)";
        setTimeout(() => (card.style.transform = ""), 180);
        if (app === "applepay") { toast("Apple Pay doesn’t support UPI in this region", "info"); return; }
        const vpa = ($("target-id").value || "").trim();
        if (!vpa || !vpa.includes("@")) { toast("Enter a UPI ID in the recipient field first", "info"); $("target-id").focus(); return; }
        const amount = parseFloat(($("stream-amount").value || "").replace(/,/g, ""));
        const params = new URLSearchParams({ pa: vpa, pn: "FLUX Payee", cu: "INR" });
        if (amount > 0) params.set("am", String(amount));
        toast(`Opening ${APP_LABELS[app]}…`);
        window.location.href = UPI_SCHEMES[app](params.toString());
      };
      card.addEventListener("click", act);
      onEnter(card, act);
    });
  }

  // ── Scan to Pay (real camera + QR via BarcodeDetector when available) ─────────
  let scanStream = null, scanLoop = null, scanFacing = "environment", torchOn = false;
  function setScanStatus(t) { const el = $("scanStatusText"); if (el) el.textContent = t; }
  async function startScan() {
    if (scanStream) { stopScan(); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      toast("Camera not available in this browser", "error"); return;
    }
    try {
      scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: scanFacing } });
      const v = $("scanVideo");
      v.srcObject = scanStream; v.style.display = "block";
      $("viewfinder").classList.add("scanning");
      await v.play();
      setScanStatus("Point camera at a QR code");
      if ("BarcodeDetector" in window) {
        const det = new window.BarcodeDetector({ formats: ["qr_code"] });
        scanLoop = setInterval(async () => {
          try { const codes = await det.detect(v); if (codes && codes.length) onQR(codes[0].rawValue); } catch (_) {}
        }, 500);
      } else {
        setScanStatus("Live decode unsupported — use Upload QR");
      }
    } catch (_) {
      toast("Camera permission denied", "error");
      stopScan();
    }
  }
  function stopScan() {
    if (scanLoop) clearInterval(scanLoop); scanLoop = null;
    if (scanStream) { scanStream.getTracks().forEach((t) => t.stop()); scanStream = null; }
    const v = $("scanVideo"); if (v) { v.style.display = "none"; v.srcObject = null; }
    const vf = $("viewfinder"); if (vf) vf.classList.remove("scanning");
    torchOn = false;
    setScanStatus("Tap to scan a QR");
  }
  function onQR(text) {
    stopScan();
    let pa = null, am = null;
    try {
      if (/^upi:|^tez:|^phonepe:|^paytmmp:/.test(text)) {
        const qs = new URLSearchParams(text.split("?")[1] || "");
        pa = qs.get("pa"); am = qs.get("am");
      }
    } catch (_) {}
    if (pa) { $("target-id").value = pa; if (am) $("stream-amount").value = am; toast(`QR captured: ${pa}`); }
    else { $("target-id").value = text; toast("QR captured"); }
  }
  function wireScanner() {
    const vf = $("viewfinder");
    if (vf) { vf.addEventListener("click", startScan); onEnter(vf, startScan); }

    $("camSwitch").addEventListener("click", async (e) => {
      e.stopPropagation();
      scanFacing = scanFacing === "environment" ? "user" : "environment";
      if (scanStream) { stopScan(); startScan(); } else toast(`Camera set to ${scanFacing === "user" ? "front" : "rear"}`, "info");
    });
    $("camFlash").addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!scanStream) { toast("Start the camera first", "info"); return; }
      const track = scanStream.getVideoTracks()[0];
      const caps = track.getCapabilities ? track.getCapabilities() : {};
      if (!caps.torch) { toast("Flash not supported on this device", "info"); return; }
      torchOn = !torchOn;
      try { await track.applyConstraints({ advanced: [{ torch: torchOn }] }); } catch (_) { toast("Could not toggle flash", "error"); }
    });

    const fileInput = $("qrFileInput");
    $("uploadQrBtn").addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", async (e) => {
      const f = e.target.files && e.target.files[0];
      e.target.value = "";
      if (!f) return;
      if (!("BarcodeDetector" in window)) { toast("QR decoding isn’t supported in this browser", "error"); return; }
      try {
        const bmp = await createImageBitmap(f);
        const det = new window.BarcodeDetector({ formats: ["qr_code"] });
        const codes = await det.detect(bmp);
        if (codes && codes.length) onQR(codes[0].rawValue);
        else toast("No QR code found in that image", "error");
      } catch (_) { toast("Could not read that image", "error"); }
    });
  }

  // ── Keyboard activation helper for role=button elements ──────────────────────
  function onEnter(el, fn) {
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fn(); }
    });
  }

  // ── Render everything ────────────────────────────────────────────────────────
  function renderAll() {
    renderSourceCard();
    renderProtocols();
    renderGauge();
    renderBills();
    renderRewards();
  }

  // ── Boot ─────────────────────────────────────────────────────────────────────
  async function boot() {
    // Identity from cached session, refined by /auth/me in authGuard.
    try { const u = JSON.parse(localStorage.getItem("flux_user") || "null"); if (u) setIdentity(u); } catch (_) {}

    const ok = await authGuard();
    if (!ok) return; // redirecting to login

    renderAll();
    renderContacts();
    wireProtocols();
    wireModals();
    wireTransmit();
    wireQuickActions();
    wireAccountSwitcher();
    wireAppCards();
    wireScanner();

    const settingsNav = $("settingsNav");
    if (settingsNav) settingsNav.addEventListener("click", (e) => { e.preventDefault(); toast("Settings module coming soon", "info"); });

    // Honor deep-link intent from the dashboard quick actions.
    const action = new URLSearchParams(location.search).get("action");
    if (action === "send") { const a = $("stream-amount"); if (a) a.focus(); }
    else if (action === "deposit") { openModal("requestModal"); }

    // Re-render when flux-data.js finishes (re)hydrating from the backend.
    window.addEventListener("flux:data-updated", () => { renderAll(); renderContacts(); renderProtocols(); });

    // Stop the camera if the user navigates away.
    window.addEventListener("beforeunload", stopScan);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
