# Deployment — free tier, end to end

FLUX deploys as three free pieces:

| Piece | Host | Free tier |
|---|---|---|
| Static frontend | Cloudflare Pages | Unlimited sites, no sleep |
| FastAPI backend | Google Cloud Run | 2M requests/mo, scales to zero |
| MySQL dataset | TiDB Serverless | 5 GB, no forced sleep |
| LLM (chat, insights) | Groq | Free API tier |

There is no paid step anywhere in this guide.

## Why this split

The backend installs torch, transformers (FinBERT), chromadb and xgboost —
roughly 2 GB, needing 1–2 GB RAM at idle. That does not fit the 512 MB free
tiers on Render, Fly or Railway. Cloud Run lets a service ask for 2–4 GiB and
bills per request-second, so a demo that is idle most of the day stays inside
the always-free allowance.

Hugging Face Spaces was the original choice here and the guide said so until
July 2026, when Docker Spaces moved behind PRO ($9/month). Spaces is still the
least-effort option if you happen to have PRO — the Dockerfile runs there
unchanged apart from the port.

The frontend is static, so it does not belong on the same host: Pages serves it
from the edge with no cold start, and the API can scale to zero without the
site going down with it.

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

## 3. Backend — Google Cloud Run

### One-time account setup

1. Create a project at <https://console.cloud.google.com/projectcreate>, e.g.
   `flux-api`. Note the **project ID** — it is not always what you typed.
2. Enable billing on it. A card is required even for free-tier use; nothing is
   charged while you stay inside the allowance below.
3. Install the CLI: <https://cloud.google.com/sdk/docs/install>, then

   ```bash
   gcloud auth login
   gcloud config set project <your-project-id>
   gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com
   ```

### Deploy

From the repo root:

```bash
gcloud run deploy flux-api   --source .   --region asia-south1   --allow-unauthenticated   --memory 2Gi   --cpu 2   --timeout 300   --max-instances 3   --min-instances 0
```

Cloud Build builds the Dockerfile and Cloud Run serves it. The first build takes
~10 minutes; torch and the FinBERT weights dominate. The command prints the
service URL, `https://flux-api-<hash>-<region>.a.run.app` — that is what the
frontend needs in step 4.

`--memory 2Gi` is not optional. The default 512 MiB cannot import torch, and the
failure mode is an opaque "container failed to start" rather than an OOM message.

### Runtime configuration

Set the secrets and variables on the service. Values come from steps 1 and 2:

```bash
gcloud run services update flux-api --region asia-south1   --set-env-vars "LLM_BASE_URL=https://api.groq.com/openai/v1"   --set-env-vars "LLM_MODEL=llama-3.3-70b-versatile"   --set-env-vars "LLM_API_KEY=gsk_..."   --set-env-vars "MYSQL_HOST=gateway01.<region>.prod.aws.tidbcloud.com"   --set-env-vars "MYSQL_PORT=4000"   --set-env-vars "MYSQL_USER=<user>"   --set-env-vars "MYSQL_PASSWORD=<password>"   --set-env-vars "MYSQL_DB=flux"   --set-env-vars "MYSQL_SSL=true"   --set-env-vars "AUTH_REQUIRED=true"   --set-env-vars "AUTH_SECRET=<a long random string>"   --set-env-vars "INGESTION_ENABLED=true"   --set-env-vars "INGESTION_INTERVAL_MIN=30"
```

Plus whichever market-data keys you use (`FINNHUB_API_KEY`, `COINGECKO_API_KEY`,
`NEWSAPI_KEY`, …) — see [API_KEYS.md](API_KEYS.md). For anything sensitive,
Secret Manager (`--set-secrets`) is better than `--set-env-vars`; env vars are
visible to anyone with console read access on the project.

Then check `https://<service-url>/health`. It should report `"provider":
"openai"` and your model.

**Raise `INGESTION_INTERVAL_MIN`.** The scheduler runs nine jobs; at the default
5 minutes a public deployment will exhaust the free market-data quotas
(Finnhub allows 60 requests/minute, NewsAPI 100 requests/day) within hours.

### Redeploying

Re-run the same `gcloud run deploy` command. There is no push-to-deploy wiring;
adding it needs a service account and Workload Identity Federation, which is
more setup than a one-command redeploy is worth for this project.

## 4. Frontend — Cloudflare Pages

1. Edit **`js/flux-config.js`** and set `PRODUCTION_API` to your Cloud Run URL:

   ```js
   var PRODUCTION_API = 'https://flux-api-<hash>-<region>.a.run.app';
   ```

2. Edit **`pages/analysis.html`** and replace `https://CHANGE-ME.run.app` in
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

   ```bash
   gcloud run services update flux-api --region asia-south1      --set-env-vars 'CORS_ORIGINS=["https://<your-site>.pages.dev"]'
   ```

The build copies an allowlist into `dist/` — see
[scripts/build-static.mjs](../scripts/build-static.mjs). Pages serves its
output directory verbatim, so pointing it at the repo root would publish
`backend/*.py` and `seed_mysql.py` as downloadable files.

---

## Known limits of the free tier

- **Cloud Run scales to zero.** The first request after an idle period pays a
  cold start, and this image is slow to start because importing torch is slow —
  budget 30–60 s. `--min-instances 1` removes it but leaves an instance billing
  around the clock, which does not stay inside the free allowance.
- **The container filesystem is in-memory.** SQLite ingestion history and the
  Chroma vector store reset on every new revision *and* count against the 2 GiB
  RAM while they live. Anything that must survive belongs in MySQL.
- **`--allow-unauthenticated` makes the API world-reachable.** That is what the
  static frontend needs, so keep `AUTH_REQUIRED=true` and treat every route as
  publicly callable.
- **Watch the billing page for the first week.** The free allowance is per-month
  and generous for a demo, but a scheduler misconfiguration that keeps an
  instance warm will quietly eat it. Set a budget alert at $1.
- **Market-data quotas are the real ceiling**, not compute. Tune
  `INGESTION_INTERVAL_MIN` and `INSIGHT_MAX_ASSETS` before opening the link up.

## Verifying a deployment

```bash
curl https://<service-url>/health
```

Check in the response:

- `"agent": {"available": true, "provider": "openai"}` — the LLM key is live.
- `"scheduler": {"running": true}` — ingestion is up.
- `"keys"` — each market-data provider that is configured.

Then open the Pages URL and confirm the browser console is clean. A
`CHANGE-ME` error there means step 4.1 was missed; a CORS error means the
service's `CORS_ORIGINS` does not list the Pages domain.
