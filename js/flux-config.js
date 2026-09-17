/**
 * FLUX — deployment config
 * ========================
 *
 * The one file to edit when the API moves. Load it BEFORE every other FLUX
 * script; everything else (flux-data.js, market-live.js, dashboard.js, the
 * inline blocks in careers/faq/login/signin) reads window.FLUX_CONFIG.apiBase
 * and falls back to its own guess only when this file hasn't run.
 *
 * Why this exists: the frontend is static and deploys to Cloudflare Pages,
 * while the API runs on a separate host. The previous fallback chain ended at
 * location.origin, which is correct behind a reverse proxy but points at the
 * Pages domain here — every request would 404 against the static site.
 *
 * Local development is unchanged: on localhost this still resolves to :8000,
 * so there is nothing to edit or revert while working locally.
 */
(function fluxConfig() {
  'use strict';

  // ── Edit this one line after deploying the backend ────────────────────────
  // Hugging Face Space URLs look like:
  //   https://<username>-<space-name>.hf.space
  var PRODUCTION_API = 'https://CHANGE-ME.hf.space';

  var host = window.location.hostname;
  var isLocal = host === 'localhost' || host === '127.0.0.1' || host === '';

  var apiBase = isLocal
    ? 'http://' + (host || 'localhost') + ':8000'
    : PRODUCTION_API;

  // A FLUX_CONFIG set by an inline script before this file wins, so a single
  // page can still be pointed at a different backend for debugging.
  var existing = window.FLUX_CONFIG || {};
  window.FLUX_CONFIG = {
    apiBase: (existing.apiBase || apiBase).replace(/\/$/, ''),
    userId: existing.userId || 1
  };

  // Legacy alias — several page scripts read window.FLUX_API directly.
  window.FLUX_API = window.FLUX_CONFIG.apiBase;

  if (!isLocal && window.FLUX_CONFIG.apiBase.indexOf('CHANGE-ME') !== -1) {
    console.error(
      '[FLUX] PRODUCTION_API is still the placeholder in js/flux-config.js — ' +
      'every API call from this deployment will fail. Set it to your backend URL.'
    );
  }
})();
