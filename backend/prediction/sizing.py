"""
FLUX Prediction — Position Sizing (fractional Kelly)
====================================================
Turns a CALIBRATED win-probability into a position size. Kelly maximises long-run growth;
we use a FRACTION of it (default 1/4) because full Kelly is far too aggressive on noisy
financial edges, and because Kelly assumes the probability is exactly right — only safe
when p is calibrated (which ours is, via isotonic regression).

    f* = (p·b − (1−p)) / b          # Kelly fraction for a bet paying b:1 at win-prob p
    size = clip(frac · f*, 0, cap)

For triple-barrier labels with symmetric barriers (pt == sl), the payoff ratio b ≈ 1, so
f* ≈ 2p − 1. A calibrated p of 0.55 → f* ≈ 0.10 → quarter-Kelly size ≈ 0.025.
"""

from __future__ import annotations


def kelly_fraction(p: float, b: float = 1.0, frac: float = 0.25, cap: float = 0.5) -> float:
    """Fractional-Kelly position size in [0, cap] from win-prob p and payoff ratio b."""
    if p <= 0.0 or p >= 1.0:
        return 0.0
    f_star = (p * b - (1.0 - p)) / b
    if f_star <= 0:
        return 0.0
    return float(min(cap, frac * f_star))


def regime_scale(regime: str | None) -> float:
    """Down-scale size in non-trending regimes (HMM gate, Part 4). Source of truth: regime.REGIME_SCALE."""
    return {"trend": 1.0, "chop": 0.6, "risk_off": 0.25}.get(regime or "trend", 1.0)
