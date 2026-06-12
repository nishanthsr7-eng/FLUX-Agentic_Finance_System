# API Keys

How to obtain every API key and credential FLUX uses. All values go into the
`.env` file in the project root (see [docs/SETUP.md](SETUP.md)). Every market
key is optional and degrades gracefully — the minimum set for the live dashboard
is **Finnhub + CoinGecko + NewsAPI**.

> Security: never commit `.env`, never paste real keys into documentation or
> source, and rotate any key that has been exposed.

---

## Market Data

### Finnhub — `FINNHUB_API_KEY`
- Used for: live equity quotes, per-ticker company news, earnings calendar.
- Get it: <https://finnhub.io/register> → free tier (60 requests/min).

### CoinGecko — `COINGECKO_API_KEY`
- Used for: top-15 crypto quotes, market caps, 7-day sparklines.
- Get it: <https://www.coingecko.com/en/api> → Demo plan. The demo key is sent
  via the `x-cg-demo-api-key` header.

### Alpha Vantage — `ALPHA_VANTAGE_API_KEY`
- Used for: backup price history, fundamentals, news sentiment.
- Get it: <https://www.alphavantage.co/support/#api-key> (free, 25 req/day).

### Polygon.io — `POLYGON_API_KEY`
- Used for: equity aggregates / intraday (optional upgrade path).
- Get it: <https://polygon.io/dashboard/signup> → free tier.

### NewsAPI — `NEWSAPI_KEY`
- Used for: finance/crypto headlines (ticker drawer + scrolling ticker).
- Get it: <https://newsapi.org/register> → free developer tier.

### FRED — `FRED_API_KEY`
- Used for: macro regime features (term/credit spread, rates, CPI).
- Get it: <https://fredaccount.stlouisfed.org/apikeys> (free).

---

## Crypto Data

### Coinglass — `COINGLASS_API_KEY`
- Used for: aggregated funding rate, open interest, liquidations.
- Get it: <https://www.coinglass.com/pricing>.

### CryptoCompare — `CRYPTOCOMPARE_API_KEY`
- Used for: crypto social/market data.
- Get it: <https://www.cryptocompare.com/cryptopian/api-keys> (free tier).

---

## Fundamentals and Filings

### Financial Modeling Prep — `FMP_API_KEY`
- Used for: fundamentals, ratios, earnings calendar. Also serves the
  no-auth stock-logo CDN used in the UI.
- Get it: <https://site.financialmodelingprep.com/developer/docs> (free tier).

### Tiingo — `TIINGO_API_KEY`
- Used for: fundamentals and end-of-day prices.
- Get it: <https://www.tiingo.com/account/api/token> (free tier).

### SEC EDGAR — `SEC_USER_AGENT`
- Used for: EDGAR fundamentals. This is **not a key** — SEC requires a
  descriptive User-Agent containing a contact email.
- Format: `your_name your_email@example.com`. See
  <https://www.sec.gov/os/webmaster-faq#developers>.

---

## Sentiment and Models

### Hugging Face — `HUGGINGFACE_TOKEN`
- Used for: pulling FinBERT, CryptoBERT, and foundation-model baselines.
- Get it: <https://huggingface.co/settings/tokens> → a "read" token.

### Reddit (PRAW) — `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`
- Used for: retail-flow sentiment from finance subreddits.
- Get it: <https://www.reddit.com/prefs/apps> → create a "script" app. The
  client ID is under the app name; the secret is the `secret` field. Set a
  descriptive `REDDIT_USER_AGENT`.

---

## Paper Trading (never live)

### Alpaca — `ALPACA_API_KEY`, `ALPACA_SECRET_KEY`
- Used for: paper-account forward testing of signals only. The backend hard-
  defaults to the paper endpoint (`ALPACA_PAPER=true`) and never trades live.
- Get it: <https://alpaca.markets/> → generate **paper** trading keys.

---

## Datasets

### Kaggle — `KAGGLE_USERNAME`, `KAGGLE_KEY`
- Used for: downloading the Huge Stock Market dataset.
- Get it: <https://www.kaggle.com/settings> → "Create New Token" downloads a
  `kaggle.json` containing the username and key. Note the Kaggle CLI expects the
  variable to be named `KAGGLE_KEY`.

---

## Local Services (no key)

| Variable | Purpose | Default |
|---|---|---|
| `OLLAMA_URL` | Local Ollama endpoint | `http://localhost:11434` |
| `OLLAMA_MODEL` | Model name to call | `aura` |
| `MYSQL_*` | Seeded application database | `127.0.0.1:3306`, db `flux` |
| `DB_PATH` / `CHROMA_PATH` | SQLite / ChromaDB locations | per-user app-data dir |

---

## Minimum Configurations

| Goal | Required keys |
|---|---|
| Live dashboard + marketplace | `FINNHUB_API_KEY`, `COINGECKO_API_KEY`, `NEWSAPI_KEY` |
| AI insights / chat / advisor | the above + Ollama running locally |
| Prediction training (full) | add `FRED`, `HUGGINGFACE_TOKEN`, crypto + fundamentals keys, `KAGGLE_*` |
| Paper forward-test | add `ALPACA_*` (paper) |
