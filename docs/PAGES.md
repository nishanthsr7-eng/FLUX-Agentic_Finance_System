# Pages

Every page in the FLUX frontend and the features it provides. Pages live in the
project root (`index.html`) and the `pages/` directory. Styling is driven by the
design-token system in `css/`, and behaviour by the ES modules in `js/`.

---

## Landing — `index.html`

The marketing entry point and product overview.

- Hero section, animated counters, and feature highlights.
- Live market preview and scrolling news ticker.
- Navigation into the authenticated application.
- Driven by `js/main.js`, `js/animations.js`, `js/counters.js`,
  `js/particles.js`, `js/parallax.js`.

## Dashboard — `pages/dashboard.html`

The authenticated home surface consolidating the user's financial picture.

- Portfolio summary with mark-to-market valuation and unrealised P&L
  (`GET /portfolio/value`).
- Live spending and account insights from the seeded MySQL dataset.
- Market overview cards and AI insights.
- Driven by `js/dashboard.js`, `js/flux-data.js`.

## Marketplace — `pages/marketplace.html`

The trading and asset-discovery surface. **Requires authentication.**

- Live crypto and equity quotes with sparklines and 24h change.
- Paper-trading wallet, order placement, watchlist, and price alerts
  (`backend/trading_api.py`).
- Per-asset news drawer and AI intel.
- Driven by `js/marketplace.js`, `js/market-live.js`.

## Analysis — `pages/analysis.html`

Charting and quantitative analysis workspace.

- Interactive OHLCV candlestick charts (1D / 7D / 1M / 1Y) via
  `GET /market/candles/{asset}`.
- Technical indicators — RSI(14), MACD(12,26,9), volume — via
  `GET /market/indicators/{symbol}`.
- SMA-crossover backtester (`POST /backtest`) reporting total return, Sharpe,
  max drawdown, win rate, and the equity curve.
- Driven by `js/analysis.js`.

## Smart Advisor — `pages/advisor.html`

The prediction cockpit — the user-facing window into the FLUX-X agent.

- Forecast cone: recent close series plus the calibrated prediction point and
  conformal band (`GET /predict/{symbol}/forecast`).
- Calibrated confidence gauge, direction badge, and regime chip.
- Reliability/calibration view (`GET /predict/calibration`) showing realised
  hit-rate per confidence bucket — an honest empty state when no outcomes have
  resolved yet.
- Prediction leaderboard and LLM verifier verdicts (VETO / downgrade badges).
- Driven by `js/advisor.js` and `css/advisor.css`.

## Payments — `pages/payments.html`

Wallet and money-movement surface (paper / simulated).

- Transactions, recurring payments, rewards, account switching, credit limits
  (`backend/payments_api.py`).
- Driven by `js/payments.js`.

## Privacy Shield — `pages/shield.html`

Privacy and data-control centre — manage consent, visibility, and
privacy-related preferences.

## Login / Sign In — `pages/login.html`, `pages/signin.html`

Authentication surfaces — register, log in, and session handling
(`backend/auth.py`). Account-setup logic in `js/account-setup.js`.

## Security — `pages/security.html`

Describes the platform's security posture — hardened HTTP headers, strict CORS,
hashed credentials, and the paper-only trading guarantee.

## About — `pages/about.html`

Company and product background.

## Brand — `pages/brand.html`

Brand assets and visual identity guidelines.

## Careers — `pages/careers.html`

Careers and hiring information.

## Contact — `pages/contact.html`

Contact form and support channels.

## FAQ — `pages/faq.html`

Frequently asked questions.

## Legal — `pages/terms.html`, `pages/privacy.html`, `pages/cookies.html`

Terms of service, privacy policy, and cookie policy.

---

## Shared Frontend Modules

| Module | Responsibility |
|---|---|
| `js/main.js` | Global navigation, shared bootstrapping |
| `js/flux-data.js` | API client / data fetching helpers |
| `js/market-live.js` | Live quote polling and rendering |
| `js/animations.js`, `js/scroll-animations.js` | Motion and reveal effects |
| `js/particles.js`, `js/parallax.js`, `js/tilt-cards.js` | Visual effects |
| `js/magnetic-buttons.js`, `js/counters.js` | Interactive UI components |
| `css/tokens.css` | Design tokens (the single source of theme truth) |
| `css/base.css`, `css/layout-extensions.css` | Base layout and structure |
