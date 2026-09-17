# FLUX backend — container image for Hugging Face Spaces (Docker SDK).
#
# Spaces is the one free tier that fits this backend: torch + transformers
# (FinBERT) + chromadb + xgboost is a ~2 GB install that Render/Fly/Railway
# free tiers cannot hold. Spaces gives 16 GB RAM and 50 GB disk at no cost.
#
# Build locally with the same command Spaces uses:
#   docker build -t flux-api .
#   docker run --rm -p 7860:7860 --env-file .env flux-api

FROM python:3.11-slim

# Some scientific wheels (hmmlearn, arch) still build from source on slim.
# curl is kept for the healthcheck; the rest is dropped from the layer.
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        curl \
    && rm -rf /var/lib/apt/lists/*

# Spaces runs the container as uid 1000. Everything the app writes at runtime
# must be owned by that user, so create it before installing.
RUN useradd -m -u 1000 user
USER user

ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR $HOME/app

# ── Dependencies ─────────────────────────────────────────────────────────────
# CPU-only torch first, on its own index. The default PyPI wheel bundles CUDA
# and is ~2.5 GB — the CPU build is ~200 MB and there is no GPU on the free
# tier anyway. Installing it up front means the torch>=2.2 pin in
# requirements.txt is already satisfied and pip won't pull the CUDA wheel.
# The version spec must stay quoted: RUN uses a shell, which would otherwise
# read `torch>=2.2` as a redirect and write an empty file named "=2.2".
RUN pip install --no-cache-dir --user \
        --index-url https://download.pytorch.org/whl/cpu \
        "torch>=2.2"

COPY --chown=user backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir --user -r backend/requirements.txt

# ── Application ──────────────────────────────────────────────────────────────
COPY --chown=user backend ./backend

# Writable runtime paths. The defaults in config.py resolve to a per-user app
# data dir; pinning them here keeps SQLite, Chroma and the model caches inside
# the container's writable layer instead of somewhere read-only.
ENV DB_PATH=$HOME/app/data/flux_market.db \
    CHROMA_PATH=$HOME/app/data/chroma \
    HF_HOME=$HOME/app/data/hf \
    XDG_CACHE_HOME=$HOME/app/data/cache

RUN mkdir -p $HOME/app/data/chroma $HOME/app/data/hf $HOME/app/data/cache

# Spaces routes public traffic to 7860.
EXPOSE 7860

HEALTHCHECK --interval=60s --timeout=10s --start-period=120s --retries=3 \
    CMD curl -fsS http://localhost:7860/health || exit 1

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "7860"]
