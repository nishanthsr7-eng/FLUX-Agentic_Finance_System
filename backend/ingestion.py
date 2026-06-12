"""
FLUX Data Ingestion Scheduler
------------------------------
Uses APScheduler (AsyncIOScheduler) to pull live data every 5 minutes:
  • CoinGecko  → crypto price snapshots    → SQLite
  • Finnhub    → stock price snapshots     → SQLite
  • yfinance   → 30-day daily OHLCV        → SQLite  (every 30 min)
  • NewsAPI    → finance headlines         → SQLite  (every 15 min)

All jobs also update the in-memory cache (same TTLs as the live endpoints)
so the existing /market/* routes always return fresh data.
"""

import asyncio
import logging
import math
import time
from datetime import datetime, timedelta
from typing import Any

import httpx
import yfinance as yf

from .cache import cache
from .config import settings
from .db import insert_snapshots, upsert_ohlcv, insert_news, insert_history, log_ingestion

log = logging.getLogger("flux.ingestion")

# ── Shared HTTP client ────────────────────────────────────────────────────────
_client: httpx.AsyncClient | None = None

def _http() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(timeout=15.0, follow_redirects=True)
    return _client


async def close_client() -> None:
    global _client
    if _client and not _client.is_closed:
        await _client.aclose()


# ── Status tracking ───────────────────────────────────────────────────────────
_status: dict[str, Any] = {}   # job → {ts, rows, status}


def get_status() -> dict:
    return dict(_status)


def _record(job: str, rows: int, status: str = "ok", msg: str = "") -> None:
    _status[job] = {"ts": int(time.time() * 1000), "rows": rows, "status": status, "msg": msg}


# ── Asset catalogues (mirrors main.py) ───────────────────────────────────────
CRYPTO_IDS = [
    "bitcoin", "ethereum", "tether", "binancecoin", "solana",
    "ripple", "dogecoin", "cardano", "avalanche-2", "polkadot",
    "chainlink", "uniswap", "litecoin", "shiba-inu", "tron",
]

STOCK_META: dict[str, tuple[str, str]] = {
    "AAPL":  ("Apple Inc.",          "Technology"),
    "MSFT":  ("Microsoft Corp.",      "Technology"),
    "NVDA":  ("NVIDIA Corp.",         "Semiconductors"),
    "GOOGL": ("Alphabet Inc.",        "Technology"),
    "AMZN":  ("Amazon.com Inc.",      "Consumer"),
    "TSLA":  ("Tesla Inc.",           "Automotive"),
    "META":  ("Meta Platforms",       "Technology"),
    "NFLX":  ("Netflix Inc.",         "Media"),
    "JPM":   ("JPMorgan Chase",       "Financials"),
    "AMD":   ("Advanced Micro Dev.",  "Semiconductors"),
    "TSM":   ("Taiwan Semiconductor", "Semiconductors"),
    "ORCL":  ("Oracle Corp.",         "Technology"),
    "CRM":   ("Salesforce Inc.",      "Software"),
    "INTC":  ("Intel Corp.",          "Semiconductors"),
    "BABA":  ("Alibaba Group",        "Consumer"),
}
STOCK_SYMBOLS = list(STOCK_META.keys())
_FMP = "https://financialmodelingprep.com/image-stock"

# Symbols for OHLCV (yfinance ticker → label stored in DB)
OHLCV_SYMBOLS: dict[str, str] = {
    "BTC-USD": "BTC",
    "ETH-USD": "ETH",
    "SOL-USD": "SOL",
    "^NSEI":   "NIFTY",
    "AAPL":    "AAPL",
    "NVDA":    "NVDA",
    "TSLA":    "TSLA",
    "MSFT":    "MSFT",
}

# ── Training-data universe for ohlcv_history ─────────────────────────────────
# yfinance ticker → (DB label, is_crypto). Mirrors scripts/backfill_history.py's
# UNIVERSE — the 15 stocks above, 15 crypto, 3 macro series (SPX/VIX/TNX), plus
# NIFTY. NIFTY isn't in model_meta's 29-symbol training set, but giving it real
# ohlcv_history rows lets /predict/NIFTY run the same generic model so the advisor
# page's NIFTY tab gets a real forecast instead of "no coverage".
HISTORY_UNIVERSE: dict[str, tuple[str, bool]] = {
    **{sym: (sym, False) for sym in STOCK_SYMBOLS},
    "BTC-USD":     ("BTC",  True),
    "ETH-USD":     ("ETH",  True),
    "USDT-USD":    ("USDT", True),
    "BNB-USD":     ("BNB",  True),
    "SOL-USD":     ("SOL",  True),
    "XRP-USD":     ("XRP",  True),
    "DOGE-USD":    ("DOGE", True),
    "ADA-USD":     ("ADA",  True),
    "AVAX-USD":    ("AVAX", True),
    "DOT-USD":     ("DOT",  True),
    "LINK-USD":    ("LINK", True),
    "UNI7083-USD": ("UNI",  True),   # plain UNI-USD is delisted on yfinance
    "LTC-USD":     ("LTC",  True),
    "SHIB-USD":    ("SHIB", True),
    "TRX-USD":     ("TRX",  True),
    "^GSPC":  ("SPX",   False),
    "^VIX":   ("VIX",   False),
    "^TNX":   ("TNX",   False),
    "^NSEI":  ("NIFTY", False),
}

_FINANCE_DOMAINS = (
    "coindesk.com,cointelegraph.com,reuters.com,bloomberg.com,"
    "cnbc.com,marketwatch.com,wsj.com,ft.com,investing.com,"
    "cryptonews.com,decrypt.co,theblock.co"
)
_GENERAL_QUERY = (
    "bitcoin OR ethereum OR cryptocurrency OR \"stock market\" OR "
    "\"Federal Reserve\" OR \"interest rate\" OR \"S&P 500\""
)


# ── Job 1: Crypto (CoinGecko) ─────────────────────────────────────────────────
async def ingest_crypto() -> list[dict]:
    ts = int(time.time() * 1000)
    params: dict[str, Any] = {
        "vs_currency": "usd",
        "ids": ",".join(CRYPTO_IDS),
        "order": "market_cap_desc",
        "per_page": len(CRYPTO_IDS),
        "page": 1,
        "sparkline": "true",
        "price_change_percentage": "24h",
    }
    headers = {}
    if settings.COINGECKO_API_KEY:
        headers["x-cg-demo-api-key"] = settings.COINGECKO_API_KEY

    try:
        r = await _http().get(
            "https://api.coingecko.com/api/v3/coins/markets",
            params=params, headers=headers,
        )
        r.raise_for_status()
        coins = r.json()
    except Exception as exc:
        log.warning("CoinGecko fetch failed: %s", exc)
        _record("crypto", 0, "error", str(exc))
        await log_ingestion("crypto", "error", 0, str(exc))
        return []

    assets, rows = [], []
    for coin in coins:
        sym = (coin.get("symbol") or "").upper()
        price  = float(coin.get("current_price") or 0)
        change = float(coin.get("price_change_percentage_24h") or 0)
        mcap   = float(coin.get("market_cap") or 0)
        vol    = float(coin.get("total_volume") or 0)

        assets.append({
            "symbol":       f"BINANCE:{sym}USDT",
            "name":         coin.get("name", sym),
            "sub":          sym,
            "price":        price,
            "change_pct":   change,
            "market_cap":   mcap,
            "icon":         coin.get("image", ""),
            "sector":       "",
            "sparkline_7d": (coin.get("sparkline_in_7d") or {}).get("price", []),
        })
        rows.append({
            "symbol":     sym,
            "asset_type": "crypto",
            "name":       coin.get("name", sym),
            "price":      price,
            "change_pct": change,
            "volume":     vol,
            "market_cap": mcap,
            "ts":         ts,
        })

    # Update in-memory cache so live endpoints stay fresh
    cache.set("crypto", assets, ttl=settings.CRYPTO_TTL)
    await insert_snapshots(rows)
    _record("crypto", len(rows))
    await log_ingestion("crypto", "ok", len(rows))
    log.info("Ingested %d crypto snapshots", len(rows))
    return assets


# ── Job 2: Stocks (Finnhub) ───────────────────────────────────────────────────
async def _fetch_one_stock(sym: str) -> dict | None:
    try:
        r = await _http().get(
            "https://finnhub.io/api/v1/quote",
            params={"symbol": sym, "token": settings.FINNHUB_API_KEY},
        )
        if r.status_code != 200:
            return None
        q = r.json()
        price = float(q.get("c") or 0)
        if price == 0:
            return None
        prev = float(q.get("pc") or price)
        chg  = ((price - prev) / prev * 100) if prev else 0
        vol  = float(q.get("v") or 0)
        name, sector = STOCK_META.get(sym, (sym, ""))
        return {"sym": sym, "name": name, "sector": sector,
                "price": price, "chg": round(chg, 3), "vol": vol}
    except Exception as exc:
        log.debug("Finnhub %s: %s", sym, exc)
        return None


async def ingest_stocks() -> list[dict]:
    if not settings.FINNHUB_API_KEY:
        return []
    ts = int(time.time() * 1000)
    results = await asyncio.gather(*[_fetch_one_stock(s) for s in STOCK_SYMBOLS])
    assets, rows = [], []
    for r in results:
        if r is None:
            continue
        assets.append({
            "symbol":     r["sym"],
            "name":       r["name"],
            "sub":        r["sym"],
            "price":      r["price"],
            "change_pct": r["chg"],
            "market_cap": 0,
            "icon":       f"{_FMP}/{r['sym']}.png",
            "sector":     r["sector"],
        })
        rows.append({
            "symbol":     r["sym"],
            "asset_type": "stock",
            "name":       r["name"],
            "price":      r["price"],
            "change_pct": r["chg"],
            "volume":     r["vol"],
            "market_cap": 0,
            "ts":         ts,
        })

    if assets:
        cache.set("stocks", assets, ttl=settings.STOCKS_TTL)
        await insert_snapshots(rows)

    _record("stocks", len(rows))
    await log_ingestion("stocks", "ok", len(rows))
    log.info("Ingested %d stock snapshots", len(rows))
    return assets


# ── Job 3: OHLCV (yfinance, sync in executor) ────────────────────────────────
def _fetch_ohlcv_sync() -> list[dict]:
    rows = []
    for yf_sym, label in OHLCV_SYMBOLS.items():
        try:
            df = yf.Ticker(yf_sym).history(period="30d", interval="1d", auto_adjust=True)
            if df.empty:
                continue
            for ts, row in df.iterrows():
                rows.append({
                    "symbol": label,
                    "date":   str(ts.date()),
                    "open":   round(float(row["Open"]),  4),
                    "high":   round(float(row["High"]),  4),
                    "low":    round(float(row["Low"]),   4),
                    "close":  round(float(row["Close"]), 4),
                    "volume": int(row.get("Volume", 0) or 0),
                })
        except Exception as exc:
            log.warning("yfinance %s: %s", yf_sym, exc)
    return rows


async def ingest_ohlcv() -> None:
    loop = asyncio.get_event_loop()
    try:
        rows = await loop.run_in_executor(None, _fetch_ohlcv_sync)
        await upsert_ohlcv(rows)
        _record("ohlcv", len(rows))
        await log_ingestion("ohlcv", "ok", len(rows))
        log.info("Ingested %d OHLCV rows", len(rows))
    except Exception as exc:
        _record("ohlcv", 0, "error", str(exc))
        await log_ingestion("ohlcv", "error", 0, str(exc))
        log.warning("OHLCV ingestion failed: %s", exc)


# ── Job 9: ohlcv_history daily append (training data) ────────────────────────
def _clean_price(x) -> float | None:
    """Float with enough precision for micro-price tokens; None if NaN."""
    v = float(x)
    if math.isnan(v):
        return None
    return float(f"{v:.10g}")   # 10 sig figs preserves SHIB-scale prices


def _fetch_history_sync(period: str = "1mo", universe: dict[str, tuple[str, bool]] | None = None) -> list[dict]:
    """Pull a recent OHLCV window for the training universe and shape it for
    insert_history. Mirrors scripts/backfill_history.fetch_symbol but with a
    bounded lookback by default — insert_history upserts on (symbol, date) so
    re-fetching overlapping days is harmless. Pass period="max" + a one-symbol
    universe for a one-off backfill of a newly-added symbol."""
    rows: list[dict] = []
    for yf_ticker, (label, is_crypto) in (universe or HISTORY_UNIVERSE).items():
        try:
            df = yf.Ticker(yf_ticker).history(period=period, interval="1d", auto_adjust=False)
            if df.empty:
                continue
            has_adj = "Adj Close" in df.columns
            for ts, row in df.iterrows():
                close = _clean_price(row["Close"])
                if close is None or close <= 0:
                    continue
                adj = close if is_crypto else (_clean_price(row["Adj Close"]) if has_adj else close)
                rows.append({
                    "symbol":    label,
                    "date":      str(ts.date()),
                    "open":      _clean_price(row["Open"]),
                    "high":      _clean_price(row["High"]),
                    "low":       _clean_price(row["Low"]),
                    "close":     close,
                    "adj_close": adj if adj is not None else close,
                    "volume":    int(row.get("Volume", 0) or 0),
                })
        except Exception as exc:
            log.warning("ohlcv_history fetch %s: %s", yf_ticker, exc)
    return rows


async def ingest_history_daily() -> None:
    """Append the latest daily bar(s) to ohlcv_history for the training universe
    (29 model symbols + macro context + NIFTY), so predictions anchor on a fresh
    close and resolve_due() can mature outcomes."""
    loop = asyncio.get_event_loop()
    try:
        rows = await loop.run_in_executor(None, _fetch_history_sync)
        await insert_history(rows)
        _record("ohlcv_history", len(rows))
        await log_ingestion("ohlcv_history", "ok", len(rows))
        log.info("Appended %d ohlcv_history rows", len(rows))
    except Exception as exc:
        _record("ohlcv_history", 0, "error", str(exc))
        await log_ingestion("ohlcv_history", "error", 0, str(exc))
        log.warning("ohlcv_history ingestion failed: %s", exc)


# ── Job 4: News (NewsAPI) ─────────────────────────────────────────────────────
async def ingest_news() -> list[dict]:
    if not settings.NEWSAPI_KEY:
        return []
    ts = int(time.time() * 1000)
    try:
        r = await _http().get(
            "https://newsapi.org/v2/everything",
            params={
                "q":        _GENERAL_QUERY,
                "language": "en",
                "sortBy":   "publishedAt",
                "pageSize": 20,
                "apiKey":   settings.NEWSAPI_KEY,
                "domains":  _FINANCE_DOMAINS,
            },
        )
        r.raise_for_status()
        articles_raw = r.json().get("articles", [])
    except Exception as exc:
        log.warning("NewsAPI fetch failed: %s", exc)
        _record("news", 0, "error", str(exc))
        return []

    articles, rows = [], []
    for a in articles_raw:
        title = (a.get("title") or "").strip()
        url   = a.get("url") or ""
        if not title or title == "[Removed]" or not url:
            continue
        art = {
            "title":        title,
            "source":       a.get("source", {}).get("name", ""),
            "url":          url,
            "summary":      (a.get("description") or "")[:200].strip(),
            "published_at": a.get("publishedAt", ""),
            "cached_at":    ts,
        }
        articles.append(art)
        rows.append(art)

    await insert_news(rows)
    _record("news", len(rows))
    await log_ingestion("news", "ok", len(rows))
    log.info("Ingested %d news articles", len(rows))
    return articles


# ── Combined cycle (used by scheduler) ───────────────────────────────────────
async def full_market_cycle() -> dict:
    """Run crypto + stocks ingestion together. Called every 5 min."""
    crypto = await ingest_crypto()
    stocks = await ingest_stocks()
    return {"crypto": len(crypto), "stocks": len(stocks)}


# ── Scheduler factory ─────────────────────────────────────────────────────────
def build_scheduler(insight_job_fn=None):
    """
    Build and return a configured AsyncIOScheduler.
    Pass insight_job_fn to schedule the RAG insight cycle.
    """
    from apscheduler.schedulers.asyncio import AsyncIOScheduler
    from apscheduler.triggers.interval import IntervalTrigger

    scheduler = AsyncIOScheduler(timezone="UTC")

    # 1) Market data every 5 min — first run immediately
    scheduler.add_job(
        full_market_cycle,
        trigger=IntervalTrigger(minutes=5),
        id="market_cycle",
        next_run_time=datetime.utcnow(),
        misfire_grace_time=60,
        coalesce=True,
    )

    # 2) OHLCV every 30 min — first run 2 min after startup
    scheduler.add_job(
        ingest_ohlcv,
        trigger=IntervalTrigger(minutes=30),
        id="ohlcv",
        next_run_time=datetime.utcnow() + timedelta(minutes=2),
        misfire_grace_time=120,
        coalesce=True,
    )

    # 3) News every 15 min — first run 3 min after startup
    scheduler.add_job(
        ingest_news,
        trigger=IntervalTrigger(minutes=15),
        id="news",
        next_run_time=datetime.utcnow() + timedelta(minutes=3),
        misfire_grace_time=120,
        coalesce=True,
    )

    # 4) AI insight cycle every 15 min — first run 5 min after startup
    if insight_job_fn is not None:
        scheduler.add_job(
            insight_job_fn,
            trigger=IntervalTrigger(minutes=15),
            id="insights",
            next_run_time=datetime.utcnow() + timedelta(minutes=5),
            misfire_grace_time=120,
            coalesce=True,
        )

    # 5) Prune old snapshots daily at midnight UTC
    from apscheduler.triggers.cron import CronTrigger
    from .db import prune_old_snapshots
    scheduler.add_job(
        prune_old_snapshots,
        trigger=CronTrigger(hour=0, minute=0, timezone="UTC"),
        id="prune",
        coalesce=True,
    )

    # 5b) ohlcv_history daily append — daily at 00:10 UTC, before options_iv (00:20)
    #     and the prediction cycle (00:30) so they read fresh closes. Runs once
    #     ~1 min after startup too, so this dev session unblocks immediately.
    scheduler.add_job(
        ingest_history_daily,
        trigger=CronTrigger(hour=0, minute=10, timezone="UTC"),
        id="ohlcv_history",
        next_run_time=datetime.utcnow() + timedelta(minutes=1),
        misfire_grace_time=600,
        coalesce=True,
    )

    # 6) Prediction cycle daily at 00:30 UTC — the full FLUX-X §4 loop: resolve matured predictions
    #    → log a fresh batch (steps 1–7) → construct the cross-sectional book (step 8) → red-team
    #    its top-k (step 9) → paper dry-run (step 10). Runs only if the trained model artifacts are
    #    present (skips cleanly otherwise).
    from pathlib import Path as _Path
    if (_Path(__file__).parent / "prediction" / "models" / "xgb_primary.json").exists():
        async def prediction_job():
            from .prediction.flux_x import run_flux_x
            try:
                res = await run_flux_x()                   # dry-run paper by default (no live orders)
                await log_ingestion("predictions", "ok", res.get("logged", 0), str(res))
            except Exception as exc:                       # never let it crash the scheduler
                log.warning("prediction cycle failed: %s", exc)
                await log_ingestion("predictions", "error", 0, str(exc))
        scheduler.add_job(
            prediction_job,
            trigger=CronTrigger(hour=0, minute=30, timezone="UTC"),
            id="predictions",
            next_run_time=datetime.utcnow() + timedelta(minutes=8),
            misfire_grace_time=600,
            coalesce=True,
        )

        # 7) Drift-triggered retrain — weekly (Sun 02:00 UTC). Retrains ONLY if live accuracy/
        #    ECE has drifted past threshold (and the model isn't too fresh); otherwise a no-op.
        async def drift_job():
            from .prediction.drift import maybe_retrain
            try:
                res = await maybe_retrain()
                await log_ingestion("drift_retrain",
                                    "ok" if res.get("retrained") else "skip",
                                    0, res.get("reason", ""))
            except Exception as exc:
                log.warning("drift retrain failed: %s", exc)
                await log_ingestion("drift_retrain", "error", 0, str(exc))
        scheduler.add_job(
            drift_job,
            trigger=CronTrigger(day_of_week="sun", hour=2, minute=0, timezone="UTC"),
            id="drift_retrain",
            misfire_grace_time=3600,
            coalesce=True,
        )

        # 8) Options IV/skew snapshot — daily at 00:20 UTC, just before the prediction cycle so
        #    predictions read a same-day chain. Equity-only (crypto returns None); builds the
        #    options_iv flywheel that a future training feature can be validated against.
        async def options_iv_job():
            from .prediction.options import snapshot_iv
            try:
                n = await snapshot_iv(STOCK_SYMBOLS)
                await log_ingestion("options_iv", "ok", n, f"{n} symbols snapshotted")
            except Exception as exc:
                log.warning("options IV snapshot failed: %s", exc)
                await log_ingestion("options_iv", "error", 0, str(exc))
        scheduler.add_job(
            options_iv_job,
            trigger=CronTrigger(hour=0, minute=20, timezone="UTC"),
            id="options_iv",
            next_run_time=datetime.utcnow() + timedelta(minutes=5),
            misfire_grace_time=600,
            coalesce=True,
        )

    return scheduler
