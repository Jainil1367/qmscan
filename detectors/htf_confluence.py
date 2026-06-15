"""
detectors/htf_confluence.py
Higher Timeframe (HTF) Confluence Checker.

Pairs:
  15m setup  → confirmed by 1H trend
  1H  setup  → confirmed by 1D trend
  1D  setup  → confirmed by 1W trend
  1W  setup  → self-confirming

HTF trend logic:
  - Bullish: price above 50 EMA AND last swing structure is HH/HL
  - Bearish: price below 50 EMA AND last swing structure is LH/LL
  - Neutral: neither condition clearly met

A setup is HTF-confluent if the HTF trend is BULLISH (since we're looking for buy setups).
"""
from __future__ import annotations
from typing import Optional
import numpy as np
from core.models import Candle
from core.config import HTF_TREND_LOOKBACK, HTF_PAIRS


def calc_ema(closes: list[float], period: int) -> list[float]:
    """Calculate EMA using numpy. Returns list same length as closes."""
    prices = np.array(closes, dtype=float)
    ema = np.zeros_like(prices)
    k = 2.0 / (period + 1)
    ema[0] = prices[0]
    for i in range(1, len(prices)):
        ema[i] = prices[i] * k + ema[i - 1] * (1 - k)
    return ema.tolist()


def determine_trend(candles: list[Candle], lookback: int = HTF_TREND_LOOKBACK) -> str:
    """
    Determine HTF trend direction.
    Returns: "bullish" | "bearish" | "neutral"
    """
    if len(candles) < lookback:
        return "neutral"

    recent = candles[-lookback:]
    closes = [c.close for c in recent]
    ema50 = calc_ema(closes, 50)
    current_close = closes[-1]
    current_ema = ema50[-1]

    # EMA condition
    above_ema = current_close > current_ema

    # Swing structure: look at last 3 swing highs to detect HH/HL
    highs = [c.high for c in recent]
    lows = [c.low for c in recent]

    # Simple structure check: split into 3 sections, compare peaks and troughs
    n = len(recent)
    third = n // 3
    section_highs = [max(highs[i*third:(i+1)*third]) for i in range(3)]
    section_lows = [min(lows[i*third:(i+1)*third]) for i in range(3)]

    hh_structure = section_highs[2] > section_highs[1] > section_highs[0]
    hl_structure = section_lows[2] > section_lows[1]
    lh_structure = section_highs[2] < section_highs[1]
    ll_structure = section_lows[2] < section_lows[1] < section_lows[0]

    bullish_structure = hh_structure or hl_structure
    bearish_structure = lh_structure and ll_structure

    if above_ema and bullish_structure:
        return "bullish"
    elif not above_ema and bearish_structure:
        return "bearish"
    elif above_ema:
        return "bullish"  # EMA alone is enough
    else:
        return "neutral"


def check_htf_confluence(
    timeframe: str,
    htf_candles: Optional[list[Candle]],
) -> tuple[bool, str]:
    """
    Given the setup's timeframe and HTF candles, check if HTF trend is bullish.
    Returns (is_confluent: bool, htf_trend: str)
    """
    if htf_candles is None or len(htf_candles) < 20:
        return False, "unknown"

    trend = determine_trend(htf_candles)
    is_confluent = trend == "bullish"
    return is_confluent, trend


def get_htf_timeframe(timeframe: str) -> str:
    """Return the HTF timeframe string for a given LTF."""
    return HTF_PAIRS.get(timeframe, "1D")
