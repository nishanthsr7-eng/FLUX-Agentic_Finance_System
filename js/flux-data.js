/* FLUX — DB Hydration Layer
 * ==========================
 * Single source of truth = MySQL (served by the backend at /db/*).
 *
 * Strategy (zero rewrites of page render code):
 *   1. On load, fetch the seeded dataset from /db/* for the demo user.
 *   2. Map each response into the exact localStorage shape the pages already
 *      read (flux_transactions, flux_accounts, flux_portfolio, …).
 *   3. If anything changed vs the cached copy, write it and dispatch
 *      "flux:data-updated" so pages can refresh their on-screen values
 *      in place — no full page reload.
 *   4. If the backend is unreachable, leave existing localStorage / seed.js
 *      defaults in place — the app still works offline.
 *
 * Load this BEFORE seed.js and the page scripts. It also stamps
 * flux_seeded so seed.js skips its hardcoded fallback once DB data is present.
 *
 * Override the backend with:  window.FLUX_CONFIG = { apiBase: '...' }
 */
(function fluxHydrate() {
  // API base resolution: explicit FLUX_CONFIG override → dev default (:8000 on
  // localhost) → same-origin (production behind a reverse proxy serving /…).
  function defaultApiBase() {
    const h = window.location.hostname;
    if (h === 'localhost' || h === '127.0.0.1' || h === '') {
      return 'http://' + (h || 'localhost') + ':8000';
    }
    return window.location.origin;
  }
  const API = ((typeof window !== 'undefined' && window.FLUX_CONFIG && window.FLUX_CONFIG.apiBase) ||
               defaultApiBase()).replace(/\/$/, '');
  const USER = (typeof window !== 'undefined' && window.FLUX_CONFIG && window.FLUX_CONFIG.userId) || 1;
  // Single source of truth for pages — read these instead of re-deriving.
  window.FLUX_API = API;
  window.FLUX_USER_ID = USER;

  /* ── Auth interceptor ─────────────────────────────────────────────────────
   * Wraps window.fetch so every request to the FLUX API automatically carries
   * the session token, and any 401 on personal data routes the user to the
   * login page. One hook here covers all pages — no per-call-site changes.
   */
  const TOKEN_KEY = 'flux_token';
  window.FluxAuth = {
    get token() { return localStorage.getItem(TOKEN_KEY); },
    set token(t) { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); },
    loginUrl() {
      // Pages live in /pages/, the marketing index at the root.
      return location.pathname.includes('/pages/') ? 'login.html' : 'pages/login.html';
    },
    logout() {
      localStorage.removeItem(TOKEN_KEY);
      // Wipe the hydrated personal dataset on logout — it must not survive
      // into the next (possibly different) user's session.
      ['flux_user', 'flux_transactions', 'flux_accounts', 'flux_portfolio', 'flux_recurring',
       'flux_contacts', 'flux_protocols',
       'flux_reward_states', 'flux_seeded'].forEach(k => localStorage.removeItem(k));
    },
  };

  const _origFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (!url.startsWith(API)) return _origFetch(input, init);

    const opts = Object.assign({}, init);
    const token = window.FluxAuth.token;
    if (token) {
      opts.headers = Object.assign({}, opts.headers, { 'Authorization': 'Bearer ' + token });
    }
    return _origFetch(input, opts).then((res) => {
      // Expired/missing session on a protected route → go log in. /auth/*
      // is excluded so a failed login attempt doesn't redirect-loop.
      if (res.status === 401 && !url.includes('/auth/')) {
        window.FluxAuth.token = null;
        if (!location.pathname.endsWith('login.html')) {
          location.href = window.FluxAuth.loginUrl();
        }
      }
      return res;
    });
  };

  // Global sign-out: any .logout-btn click ends the session before navigating.
  document.addEventListener('click', (e) => {
    if (e.target.closest && e.target.closest('.logout-btn')) window.FluxAuth.logout();
  });
  const SEED_VERSION = '2';            // must match js/seed.js SEED_VERSION

  const num = (v) => (v == null ? 0 : Number(v));
  const inr = (v) => '₹' + num(v).toLocaleString('en-IN');
  const get = (path) => fetch(`${API}${path}`).then((r) => {
    if (!r.ok) throw new Error(`${path} → ${r.status}`);
    return r.json();
  });

  // ── API → legacy localStorage shape mappers ──────────────────────────────
  const mapTransactions = (d) => (d.transactions || []).map((t) => ({
    id: t.ext_id || ('tx_' + t.id),
    title: t.title,
    date: new Date(t.tx_date).toISOString(),
    amount: num(t.amount),
    category: t.category,
    account: t.account,
  }));

  // Only masked card data is mapped — unmasked PAN/expiry must never be
  // persisted client-side (the API no longer returns them either).
  const mapAccounts = (d) => (d.accounts || []).map((a) => ({
    name: a.name,
    val: inr(a.balance),
    balance: num(a.balance),
    creditLimit: num(a.credit_limit),
    acctType: a.acct_type,
    active: !!a.active,
    cardNum: a.card_masked,
    expiry: a.expiry_masked,
  }));

  const mapPortfolio = (d) => {
    const p = d.allocation || {};
    return { equity: p.equity_pct ?? 45, crypto: p.crypto_pct ?? 30, cash: p.cash_pct ?? 25, goal: num(p.goal) || 15000000 };
  };

  const mapRecurring = (d) => (d.recurring || []).map((r) => ({
    title: r.title, amount: num(r.amount), dueDay: r.due_day, category: r.category,
  }));

  const mapContacts = (d) => (d.contacts || []).map((c) => ({
    name: c.name, fluxId: c.flux_id, initial: c.initial,
  }));

  const mapProtocols = (sec) => (sec.settings || []).slice(0, 3).map((s) => !!s.enabled);

  const mapRewardStates = (d) => {
    const out = {};
    (d.rewards || []).forEach((r) => { out[r.reward_key] = !!r.claimed; });
    return out;
  };

  // Write only if changed; track whether any key actually changed.
  let changed = false;
  function put(key, value) {
    const next = JSON.stringify(value);
    if (localStorage.getItem(key) !== next) { localStorage.setItem(key, next); changed = true; }
  }

  let retryDelay = 15000;          // grows to a 2-minute ceiling
  let retryTimer = null;
  let hydrated   = false;

  function hydrate() {
    return Promise.all([
      get(`/db/transactions?limit=2000`),
      get(`/db/accounts`),
      get(`/db/portfolio`),
      get(`/db/recurring`),
      get(`/db/contacts`),
      get(`/db/security`),
      get(`/db/rewards`),
    ]).then(([tx, acc, pf, rec, con, sec, rew]) => {
      // Expose raw payloads for any page that wants to read directly.
      window.FluxData = { tx, acc, pf, rec, con, sec, rew };

      changed = false;
      put('flux_transactions', mapTransactions(tx));
      put('flux_accounts', mapAccounts(acc));
      put('flux_portfolio', mapPortfolio(pf));
      put('flux_recurring', mapRecurring(rec));
      put('flux_contacts', mapContacts(con));
      put('flux_protocols', mapProtocols(sec));
      put('flux_reward_states', mapRewardStates(rew));

      // Stop seed.js from injecting its hardcoded fallback.
      if (localStorage.getItem('flux_seeded') !== SEED_VERSION) {
        localStorage.setItem('flux_seeded', SEED_VERSION);
        changed = true;
      }

      const firstSuccess = !hydrated;
      hydrated = true;
      retryDelay = 15000;
      // Refresh pages on data change OR on offline→online recovery, so widgets
      // that rendered an empty state while the backend was down repopulate.
      if (changed || firstSuccess) {
        window.dispatchEvent(new CustomEvent('flux:data-updated', { detail: window.FluxData }));
      }
    }).catch((err) => {
      // Backend offline → keep existing localStorage / seed.js defaults and
      // retry with backoff so the page self-heals when the backend comes up.
      console.warn('[FLUX] DB hydration failed (backend offline?), retrying in ' +
                   Math.round(retryDelay / 1000) + 's:', err.message);
      clearTimeout(retryTimer);
      retryTimer = setTimeout(hydrate, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 120000);
    });
  }

  // Pages can force a re-hydration (e.g. when a direct fetch succeeds again
  // after being offline): window.FluxHydrate.refresh()
  window.FluxHydrate = {
    refresh() { clearTimeout(retryTimer); return hydrate(); },
    get hydrated() { return hydrated; },
  };

  hydrate();
})();
