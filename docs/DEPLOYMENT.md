# Deployment — free tier, end to end

FLUX deploys as four free pieces:

| Piece | Host | Free tier |
|---|---|---|
| Static frontend | Cloudflare Pages | Unlimited sites, no sleep |
| FastAPI backend | Render | 512 MB, 750 instance-hours/month |
| MySQL dataset | TiDB Serverless | 5 GB, no forced sleep |
| LLM (chat, insights, sentiment) | Groq | Free API tier |

There is no paid step anywhere in this guide, and **no credit card is required
at any point**. That constraint is what picked these four.

This is the guide. For the deployment that actually exists — real URLs, the
settings used, and the problems hit along the way — see
[DEPLOYMENT_RECORD.md](DEPLOYMENT_RECORD.md).

## Why this split

The full backend installs torch, transformers (FinBERT), chromadb and xgboost.
Measured resident memory after importing all of it is ~748 MB, of which torch
alone is 445 MB. Nothing free and card-free holds that.

Dropping torch brings the import cost to ~248 MB, and the app itself boots at
~120 MB because the prediction stack loads lazily. That fits Render's 512 MB
with room to serve. So the deployed image is the slim build — see
[backend/requirements-slim.txt](../backend/requirements-slim.txt) for the exact
set and what it trades away.

Two earlier choices are recorded here because they look obvious and are not:

* **Hugging Face Spaces** gave 16 GB free and was the original target. Docker
  and Gradio Spaces moved behind PRO ($9/month) in July 2026 with no
  announcement; only Static Spaces remain free, which cannot serve FastAPI.
* **Google Cloud Run** fits the full image comfortably at 2 GiB and stays
  inside its always-free allowance for a demo — but enabling billing requires
  a card even when the bill is zero. It is the right answer if you have one.

The frontend is static, so it does not belong on the same host: Pages serves it
from the edge with no cold start, and the API can sleep without the site going
down with it.

Ollama is local-only. Nothing free will host a local LLM, so the deployed build
talks to an OpenAI-compatible endpoint instead — see [backend/llm.py](../backend/llm.py).

## What the slim build gives up

Three torch-dependent features, and nothing else:

| Feature | Status on Render |
|---|---|
| FinBERT / CryptoBERT news sentiment | **replaced** — `SENTIMENT_BACKEND=llm` scores the same headlines with the chat model |
| LSTM magnitude head (`magnitude.py`) | unavailable |
| Chronos zero-shot baseline (`baselines.py`) | unavailable — the ARIMA baseline still runs |

Everything else is intact: the XGBoost direction classifier and meta-model,
conformal prediction bands, GARCH volatility, HMM regime detection, RAG and
semantic search, all market-data ingestion, every MySQL-backed dashboard, and
Groq-powered chat, insights and the verifier layer.

The sentiment swap is a real substitution, not a stub, and the two backends do
differ: FinBERT returns calibrated class probabilities, whereas the LLM returns
a judgement that clusters on round numbers. Downstream this only feeds an
aggregate mean, which is robust to that. See
[sentiment_llm.py](../backend/prediction/sentiment_llm.py).

---

## 1. Database — TiDB Serverless

1. Create a cluster at <https://tidbcloud.com> (Serverless, free).
2. **Connect → General**, and copy the host, port, user and password.
3. Seed it from your machine — set these in `.env` first, then run the seeder:

   ```
   MYSQL_HOST=gateway01.<region>.prod.aws.tidbcloud.com
   MYSQL_PORT=4000
   MYSQL_USER=<the long prefixed username>
   MYSQL_PASSWORD=<password>
   MYSQL_DB=flux
   MYSQL_SSL=true
   ```

   ```bash
   python seed_mysql.py
   ```

`MYSQL_SSL=true` is required: managed providers reject plaintext connections,
and TiDB listens on 4000, not 3306.

> Prefer no external database? The backend already has a SQLite path
> (`DB_PATH`). Only the `/db/*` routes need MySQL.

## 2. LLM — Groq

1. Create a key at <https://console.groq.com/keys>.
2. Keep it for step 3; it goes in the Space's secrets, never in the repo.

Any OpenAI-compatible endpoint works — OpenRouter's `:free` models and
Gemini's compatibility shim are both drop-in. Change `LLM_BASE_URL` and
`LLM_MODEL` to switch.

## 3. Backend — Render

No CLI and no card. Render builds the Dockerfile straight from GitHub.

1. Sign up at <https://render.com> with your GitHub account.
2. **New → Blueprint**, pick this repo. Render reads
   [render.yaml](../render.yaml) and proposes a `flux-api` web service on the
   free plan.
3. It prompts for every value marked `sync: false`. Fill in:

   | Key | Value |
   |---|---|
   | `LLM_API_KEY` | your Groq key |
   | `MYSQL_HOST` | `gateway01.<region>.prod.aws.tidbcloud.com` |
   | `MYSQL_USER` | the long prefixed TiDB username |
   | `MYSQL_PASSWORD` | the TiDB password |
   | `CORS_ORIGINS` | leave blank for now — step 4 fills it |
   | `FINNHUB_API_KEY`, `COINGECKO_API_KEY`, `ALPHA_VANTAGE_API_KEY`, `NEWSAPI_KEY`, `FRED_API_KEY` | from your `.env` |

   `AUTH_SECRET` is generated by Render; everything else is already in the
   blueprint.

4. **Apply.** The first build takes ~5 minutes — much faster than the full
   image, because torch is not in it.

5. Check `https://<service>.onrender.com/health`. It should report
   `"provider": "openai"`, your model, and `"scheduler": {"running": true}`.

### Keeping it warm

The free plan spins a service down after 15 minutes idle, and the next visitor
then waits 30–60 s. The plan also allows 750 instance-hours per month and a
month is 730 hours, so one service can stay up continuously and still fit.

**Use an external uptime monitor.** UptimeRobot's free tier checks every 5
minutes with no card required — point an HTTP(s) monitor at
`https://<service>.onrender.com/health`. It holds the instance open and tells
you about genuine downtime as well.

`/health` answers both GET and HEAD, which matters because monitors default to
HEAD and changing that is often a paid feature.

[.github/workflows/keep-warm.yml](../.github/workflows/keep-warm.yml) does the
same job on a 10-minute cron and works as a backup — add a repository
**variable** (not a secret — it is a public URL) named `FLUX_API_URL` set to
your service URL, under *Settings → Secrets and variables → Actions →
Variables*. Do not rely on it alone: GitHub queues scheduled workflows on
shared runners and they drift, sometimes by hours, and GitHub disables
scheduled workflows entirely after 60 days without a commit.

A Cloudflare Worker cron trigger was also tried and never fired at all; see
[DEPLOYMENT_RECORD.md](DEPLOYMENT_RECORD.md).

This only fits if `flux-api` is the **only** service in the Render workspace.
A second free service pushes the pair past 750 hours and both get suspended for
the rest of the month.

### Raise the ingestion interval

The blueprint sets the four interval keys below. Do not lower them. At the
development defaults a public deployment exhausts the free market-data quotas
(Finnhub 60 requests/minute, NewsAPI 100 per day) within hours. Market-data
quota is the binding constraint here, not compute.

| Key | Deployed | Effect |
|---|---|---|
| `INGESTION_INTERVAL_MIN` | 30 | crypto + stocks, 48 cycles/day |
| `OHLCV_INTERVAL_MIN` | 60 | yfinance daily bars |
| `NEWS_INTERVAL_MIN` | 60 | 24 NewsAPI calls/day against a cap of 100 |
| `INSIGHT_INTERVAL_MIN` | 60 | LLM insight cycle, chained to the market cycle |

`INGESTION_INTERVAL_MIN` was previously read from the environment but never
used — the scheduler had 5/30/15 hardcoded, so setting it to 30 changed
nothing and NewsAPI's quota still went early. All four keys are honoured now.

### Keep the heavy jobs off the boot path

The blueprint sets `HEAVY_JOBS_ON_STARTUP=false`. On 512 MB this is not
optional. The prediction cycle, the options snapshot and the drift retrain
otherwise each get a one-off run a few minutes after every boot, on top of a
process already holding FastAPI, pandas and the ONNX embedder. If one of those
runs is what exhausts the memory, the OOM kill restarts the service, which
schedules the run again — a crash loop rather than a single bad cycle.

With it false, the cron triggers (00:20, 00:30, Sun 02:00 UTC) are untouched
and you can still run a cycle by hand:

```bash
curl -X POST https://<service>.onrender.com/ingestion/trigger/predictions
```

### If you have more RAM available

The same Dockerfile builds the full image with `--build-arg FULL=1`, which
restores FinBERT, the LSTM magnitude head and the Chronos baseline. Set
`SENTIMENT_BACKEND=auto` alongside it. It needs ~1 GB.

## 4. Frontend — Cloudflare Pages

1. Edit **`js/flux-config.js`** and set `PRODUCTION_API` to your Render URL:

   ```js
   var PRODUCTION_API = 'https://flux-api.onrender.com';
   ```

2. Edit **`pages/analysis.html`** and replace `https://CHANGE-ME.onrender.com` in
   the `connect-src` of its CSP with the same URL. That page has a
   Content-Security-Policy, so the browser blocks the API regardless of what
   the config resolves to unless the origin is named there.

3. Commit and push both.

4. At <https://dash.cloudflare.com> → **Workers & Pages → Create → Pages →
   Connect to Git**, pick the repo and set:

   | Setting | Value |
   |---|---|
   | Build command | `npm run build` |
   | Build output directory | `dist` |

5. Deploy, then point the API at the `*.pages.dev` domain Cloudflare gives you:
   in the Render dashboard, *Environment* → set

   ```
   CORS_ORIGINS = ["https://<your-site>.pages.dev"]
   ```

   Render redeploys automatically when an env var changes.

The build copies an allowlist into `dist/` — see
[scripts/build-static.mjs](../scripts/build-static.mjs). Pages serves its
output directory verbatim, so pointing it at the repo root would publish
`backend/*.py` and `seed_mysql.py` as downloadable files.

---

## Known limits of the free tier

- **512 MB is the ceiling, and it is real.** The app boots at ~120 MB; Chroma's
  ONNX embedder adds ~45 MB on its first embed, and the prediction cycle's
  dataframes, HMM and GARCH fits are the largest transient on top of that.
  Two things keep it inside the budget: `HEAVY_JOBS_ON_STARTUP=false` (above),
  and the embedder being baked into the Docker image, so its 80 MB download and
  tar extraction happen on the builder rather than in a near-full container.
  If it still OOMs, set `RAG_ENABLED=false` — a dashboard env-var flip, no
  redeploy. That drops ChromaDB, onnxruntime and the embedder from the process;
  RAG-backed chat context and semantic search degrade and nothing else changes.
- **Free services spin down after 15 minutes idle** unless the keep-warm
  workflow is running. The URL stays live either way; a cold visitor just waits.
- **The disk is ephemeral.** SQLite ingestion history and the Chroma vector
  store reset on every deploy and every spin-down. Anything that must survive
  belongs in MySQL.
- **The API is world-reachable.** That is what the static frontend needs, so
  keep `AUTH_REQUIRED=true` and treat every route as publicly callable.
- **Market-data quotas are the real ceiling**, not compute. Tune
  `INGESTION_INTERVAL_MIN` and `INSIGHT_MAX_ASSETS` before sharing the link.
- **Groq is now in the request path for sentiment.** A scoring pass is one call
  per 20 headlines. At a 30-minute interval that is comfortable, but lowering
  the interval multiplies LLM calls as well as market-data calls.

## Verifying a deployment

```bash
curl https://<service>.onrender.com/health
```

Check in the response:

- `"agent": {"available": true, "provider": "openai"}` — the LLM key is live.
  This also confirms sentiment scoring works, since it uses the same client.
- `"scheduler": {"running": true}` — ingestion is up.
- `"keys"` — each market-data provider that is configured.

Then open the Pages URL and confirm the browser console is clean. A
`CHANGE-ME` error there means step 4.1 was missed; a CORS error means the
service's `CORS_ORIGINS` does not list the Pages domain.

The first load after an idle period is slow by design — see *Keeping it warm*.
The static site appears immediately either way; only the data panels wait.
