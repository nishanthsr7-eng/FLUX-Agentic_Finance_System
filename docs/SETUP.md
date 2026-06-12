# Setup Guide

Complete instructions for installing and running FLUX locally on Windows,
macOS, or Linux.

---

## 1. Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Python | 3.10 or newer | Backend and prediction agent |
| Node.js | 18 or newer | Frontend dev server (`live-server`) |
| MySQL Server | 8.0 or newer | Seeded dataset for user-facing pages |
| Ollama | latest | Local LLM for insights, chat, and the verifier layer |
| Git | any | Cloning and version control |

Optional but recommended:
- A C/C++ build toolchain for some Python wheels (`xgboost`, `hmmlearn`).
- A CUDA-capable GPU for faster `torch`/FinBERT inference (CPU works fine).

---

## 2. Clone and Install

### 2.1 Frontend

```bash
npm install
```

This installs `live-server`, the only frontend dependency.

### 2.2 Backend

Create and activate a virtual environment, then install Python dependencies:

```bash
# Windows (PowerShell)
python -m venv .venv
.\.venv\Scripts\Activate.ps1

# macOS / Linux
python3 -m venv .venv
source .venv/bin/activate

pip install -r backend/requirements.txt
```

---

## 3. Configure Secrets (`.env`)

Create a file named `.env` in the project root. The backend reads it through
`backend/config.py` (Pydantic settings). See
[docs/API_KEYS.md](API_KEYS.md) for how to obtain each value.

```dotenv
# ── Market data ───────────────────────────────
FINNHUB_API_KEY=your_key_here
COINGECKO_API_KEY=your_key_here
ALPHA_VANTAGE_API_KEY=your_key_here
POLYGON_API_KEY=your_key_here
NEWSAPI_KEY=your_key_here
FRED_API_KEY=your_key_here

# ── Crypto data ───────────────────────────────
COINGLASS_API_KEY=your_key_here
CRYPTOCOMPARE_API_KEY=your_key_here

# ── Fundamentals ──────────────────────────────
FMP_API_KEY=your_key_here
TIINGO_API_KEY=your_key_here
SEC_USER_AGENT=your_email@example.com

# ── Sentiment / models ────────────────────────
HUGGINGFACE_TOKEN=your_token_here
REDDIT_CLIENT_ID=your_id_here
REDDIT_CLIENT_SECRET=your_secret_here

# ── Paper trading (NEVER live) ────────────────
ALPACA_API_KEY=your_key_here
ALPACA_SECRET_KEY=your_key_here

# ── Datasets ──────────────────────────────────
KAGGLE_USERNAME=your_username
KAGGLE_KEY=your_key_here

# ── Ollama ────────────────────────────────────
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=aura

# ── MySQL ─────────────────────────────────────
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=your_password
MYSQL_DB=flux
```

> Every market key degrades gracefully: if a key is absent, the dependent
> feature is disabled rather than crashing the app. The minimum viable set for
> the live dashboard is `FINNHUB_API_KEY`, `COINGECKO_API_KEY`, and
> `NEWSAPI_KEY`.

**Never commit `.env`.** It is excluded by `.gitignore`.

---

## 4. Database Setup

### 4.1 SQLite (automatic)

The live market database (`flux_market.db`) is created automatically on first
backend startup. By default it is stored in the per-user app-data directory
(`%LOCALAPPDATA%\flux` on Windows, `~/.local/share/flux` elsewhere) so the dev
static server never exposes it publicly. Override with `DB_PATH` in `.env`.

### 4.2 MySQL (seeded application dataset)

The user-facing pages (dashboard, payments, profile) read from a seeded MySQL
database. Create it and run the seed script:

```bash
# Create the database (matching MYSQL_DB in .env)
mysql -u root -p -e "CREATE DATABASE flux CHARACTER SET utf8mb4;"

# Seed it with the application dataset
python seed_mysql.py
```

---

## 5. Ollama (Local LLM)

The insights, chat, RAG, and prediction-verifier layers call a local Ollama
model named `aura`.

```bash
# Install Ollama from https://ollama.com, then:
ollama serve

# The custom model is defined in ai_engine/models/Modelfile
ollama create aura -f ai_engine/models/Modelfile
```

If Ollama is offline, the app degrades honestly — AI panels show an
"unavailable" state and live prices/headlines continue to work.

---

## 6. Run the Application

Open two terminals from the project root.

**Terminal 1 — Backend API (port 8000):**

```bash
uvicorn backend.main:app --reload --port 8000
```

On Windows you can also use the helper: `start-backend.bat`.

**Terminal 2 — Frontend (port 3000):**

```bash
npm run dev
```

Visit <http://localhost:3000>. Verify the backend at
<http://localhost:8000/health> — the response reports cache, scheduler, Chroma,
ingestion, and Ollama status.

---

## 7. Optional — Train the Prediction Agent

To produce real forecasts (instead of the empty state) you must download
training data and train the models. Summary:

```bash
# 1. Download datasets (see docs/DATASETS.md for all sources)
python scripts/dl_binance.py
python scripts/dl_deribit.py
python scripts/dl_coinmetrics.py

# 2. Backfill years of daily OHLCV into the ohlcv_history table
python scripts/backfill_history.py

# 3. Train + calibrate + persist the models
python backend/prediction/train.py
```

The full pipeline, gates, and algorithms are documented in
[docs/AGENT_TRAINING.md](AGENT_TRAINING.md).

---

## 8. Running Tests

```bash
pytest backend/prediction
```

The prediction package ships unit tests covering features, labeling,
cross-validation leakage, the ensemble, and portfolio construction.

---

## 9. Troubleshooting

| Symptom | Cause / Fix |
|---|---|
| `FINNHUB_API_KEY not configured` (503) | Add the key to `.env` and restart Uvicorn. |
| Stocks panel empty | Markets closed, or Finnhub free-tier rate limit (60 req/min). |
| `Ollama is not running` (503) | Run `ollama serve` and ensure the `aura` model exists. |
| MySQL connection refused | Confirm the server is running and `.env` credentials match. |
| Prediction pages show "no coverage" | Run dataset download + `backfill_history.py` + `train.py`. |
| Frontend serves `.db`/`.log` files | The `live-server` `--ignorePattern` excludes them; do not move the DB into the project root. |
