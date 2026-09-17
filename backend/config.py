"""
FLUX Backend — Configuration
Reads API keys and tunables from the project-root .env file.
"""
from pathlib import Path
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # ── Market Data ───────────────────────────────────────────
    COINGECKO_API_KEY: str = ""
    FINNHUB_API_KEY:   str = ""
    ALPHA_VANTAGE_API_KEY: str = ""
    NEWSAPI_KEY:       str = ""
    FRED_API_KEY:      str = ""          # macro series (term spread, rates, CPI) — optional

    # ── Reddit (retail-flow sentiment) ────────────────────────
    REDDIT_CLIENT_ID:     str = ""
    REDDIT_CLIENT_SECRET: str = ""
    REDDIT_USER_AGENT:    str = "flux-market/0.1"

    # ── Alpaca (paper forward-test only — NEVER live trading) ─
    ALPACA_API_KEY:    str = ""
    ALPACA_SECRET_KEY: str = ""
    ALPACA_PAPER:      bool = True       # hard default: paper endpoint only

    # ── Cache TTLs (seconds) ──────────────────────────────────
    CRYPTO_TTL:  int = 30     # matches client sweep interval
    STOCKS_TTL:  int = 60     # Finnhub free tier: 60 req/min
    NEWS_TTL:    int = 300    # news refreshes every 5 min

    # ── Ollama (local dev LLM) ───────────────────────────────
    OLLAMA_URL:   str = "http://localhost:11434"
    OLLAMA_MODEL: str = "aura"

    # ── Hosted LLM (deployment) ──────────────────────────────
    # No free host will run Ollama for us, so deployed builds point at an
    # OpenAI-compatible endpoint instead (Groq, OpenRouter, Gemini's compat
    # shim, …). Setting LLM_API_KEY is what switches backend/llm.py over;
    # leave it empty and everything keeps using local Ollama.
    # LLM_PROVIDER: "" = auto (key present → openai), or force "openai"/"ollama".
    LLM_PROVIDER: str = ""
    LLM_BASE_URL: str = "https://api.groq.com/openai/v1"
    LLM_API_KEY:  str = ""
    LLM_MODEL:    str = "llama-3.3-70b-versatile"

    # ── CORS ─────────────────────────────────────────────────
    # Dev frontend origins only — widen explicitly via .env for deployment,
    # never back to "*" (wildcard + Authorization headers is a footgun).
    CORS_ORIGINS: list[str] = [
        "http://localhost:3000", "http://127.0.0.1:3000",
    ]

    # ── Auth ─────────────────────────────────────────────────
    # AUTH_REQUIRED=false → unauthenticated requests act as the demo user
    # (id=1). Keep true for anything reachable by others.
    AUTH_REQUIRED: bool = True
    # Empty → a random secret is generated and persisted in the app-data dir.
    AUTH_SECRET: str = ""

    # ── Persistence ───────────────────────────────────────────
    # Empty → auto-resolve to the per-user app-data dir (%LOCALAPPDATA%/flux on
    # Windows, ~/.local/share/flux elsewhere). Never default these into the
    # project root: the dev static server serves that directory publicly.
    DB_PATH:     str = ""
    CHROMA_PATH: str = ""

    # ── MySQL (seeded "ultimate" dataset for all pages) ───────
    MYSQL_HOST:     str = "127.0.0.1"
    MYSQL_PORT:     int = 3306
    MYSQL_USER:     str = "root"
    MYSQL_PASSWORD: str = ""
    MYSQL_DB:       str = "flux"

    # ── Ingestion ─────────────────────────────────────────────
    INGESTION_ENABLED:        bool = True
    INGESTION_INTERVAL_MIN:   int  = 5    # crypto + stocks cycle
    INSIGHT_MAX_ASSETS:       int  = 6    # top movers to analyse per cycle
    SNAPSHOT_RETENTION_DAYS:  int  = 7    # prune older price_snapshots

    model_config = {
        "env_file": str(Path(__file__).parent.parent / ".env"),
        "extra": "ignore",
    }


settings = Settings()
