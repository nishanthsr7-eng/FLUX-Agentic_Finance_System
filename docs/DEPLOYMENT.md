# Deployment — free tier, end to end

FLUX deploys as three free pieces:

| Piece | Host | Free tier |
|---|---|---|
| Static frontend | Cloudflare Pages | Unlimited sites, no sleep |
| FastAPI backend | Hugging Face Spaces (Docker) | 16 GB RAM, 2 vCPU, 50 GB disk |
| MySQL dataset | TiDB Serverless | 5 GB, no forced sleep |
| LLM (chat, insights) | Groq | Free API tier |

There is no paid step anywhere in this guide.

## Why this split

The backend installs torch, transformers (FinBERT), chromadb and xgboost —
roughly 2 GB, needing 1–2 GB RAM at idle. That does not fit the 512 MB free
tiers on Render, Fly or Railway; Spaces is the only free host large enough.

The frontend is static, so it does not belong on the same host: Pages serves it
from the edge with no cold start, and the Space can sleep without the site
going down with it.

Ollama is local-only. Nothing free will host a local LLM, so the deployed build
talks to an OpenAI-compatible endpoint instead — see [backend/llm.py](../backend/llm.py).

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

## 3. Backend — Hugging Face Spaces

1. Create a Space at <https://huggingface.co/new-space> → SDK: **Docker**,
   visibility public (private Spaces are not free to serve).
2. In the **GitHub repo**, add these under
   *Settings → Secrets and variables → Actions*:

   | Secret | Value |
   |---|---|
   | `HF_TOKEN` | A **write** token from <https://huggingface.co/settings/tokens> |
   | `HF_USERNAME` | Your Hugging Face username |
   | `HF_SPACE` | The Space name, e.g. `flux-api` |

3. In the **Space**, add the runtime config under
   *Settings → Variables and secrets*:

   ```
   LLM_API_KEY      = gsk_...                # secret
   LLM_BASE_URL     = https://api.groq.com/openai/v1
   LLM_MODEL        = llama-3.3-70b-versatile
   MYSQL_HOST       = gateway01.<region>.prod.aws.tidbcloud.com
   MYSQL_PORT       = 4000
   MYSQL_USER       = <user>
   MYSQL_PASSWORD   = <password>             # secret
   MYSQL_DB         = flux
   MYSQL_SSL        = true
   AUTH_REQUIRED    = true
   AUTH_SECRET      = <a long random string> # secret
   CORS_ORIGINS     = ["https://<your-site>.pages.dev"]
   INGESTION_ENABLED        = true
   INGESTION_INTERVAL_MIN   = 30
   ```

   Plus whichever market-data keys you use (`FINNHUB_API_KEY`,
   `COINGECKO_API_KEY`, `NEWSAPI_KEY`, …) — see [API_KEYS.md](API_KEYS.md).

4. Push to `main`. The
   [deploy workflow](../.github/workflows/deploy-hf.yml) syncs the repo to the
   Space and it builds automatically. First build takes ~10 minutes; torch and
   the FinBERT weights dominate.

5. Check `https://<username>-<space>.hf.space/health`. It should report
   `"provider": "openai"` and your model.

**Raise `INGESTION_INTERVAL_MIN`.** The scheduler runs nine jobs; at the default
5 minutes a public deployment will exhaust the free market-data quotas
(Finnhub allows 60 requests/minute, NewsAPI 100 requests/day) within hours.

## 4. Frontend — Cloudflare Pages

1. Edit **`js/flux-config.js`** and set `PRODUCTION_API` to your Space URL:

   ```js
   var PRODUCTION_API = 'https://<username>-<space>.hf.space';
   ```

2. Edit **`pages/analysis.html`** and replace `https://CHANGE-ME.hf.space` in
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

5. Deploy, then set `CORS_ORIGINS` in the Space to the `*.pages.dev` domain
   Cloudflare gives you and restart the Space.

The build copies an allowlist into `dist/` — see
[scripts/build-static.mjs](../scripts/build-static.mjs). Pages serves its
output directory verbatim, so pointing it at the repo root would publish
`backend/*.py` and `seed_mysql.py` as downloadable files.

---

## Known limits of the free tier

- **The Space sleeps after 48 hours idle.** The first request after that waits
  for a cold start. Nothing is lost; it restarts from the image.
- **The Space's disk is ephemeral.** SQLite ingestion history and the Chroma
  vector store reset on restart. Anything that must survive belongs in MySQL.
  Persistent storage on Spaces is a paid add-on.
- **Free Spaces are public.** The code is already on GitHub, but treat the
  running API as world-readable and keep `AUTH_REQUIRED=true`.
- **Market-data quotas are the real ceiling**, not compute. Tune
  `INGESTION_INTERVAL_MIN` and `INSIGHT_MAX_ASSETS` before opening the link up.

## Verifying a deployment

```bash
curl https://<username>-<space>.hf.space/health
```

Check in the response:

- `"agent": {"available": true, "provider": "openai"}` — the LLM key is live.
- `"scheduler": {"running": true}` — ingestion is up.
- `"keys"` — each market-data provider that is configured.

Then open the Pages URL and confirm the browser console is clean. A
`CHANGE-ME` error there means step 4.1 was missed; a CORS error means the
Space's `CORS_ORIGINS` does not list the Pages domain.
