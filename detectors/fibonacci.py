"""
detectors/fibonacci.py
Fibonacci retracement calculator and 4-setup classifier.

Given a confirmed CHoCH with swing_high and swing_low, this module:
  1. Calculates all key Fib levels
  2. Determines which setup (1–4) the current price fits into
  3. Computes entry, stop loss, and target prices
"""
from __future__ import annotations
from typing import Optional
from core.models import Candle, CHoCH, DetectedSetup
from core.config import SETUPS, SetupConfig
import uuid
from datetime import datetime


# Key Fibonacci levels as fractions of the swing range
FIB_LEVELS = {
    "0.0":   0.000,
    "23.6":  0.236,
    "38.2":  0.382,
    "50.0":  0.500,
    "61.8":  0.618,
    "78.6":  0.786,
    "88.6":  0.886,
    "100.0": 1.000,
    "113.0": 1.130,
}


def calc_fib_price(swing_high: float, swing_low: float, level: float) -> float:
    """
    For a BULLISH retracement:
      price = swing_high - (swing_high - swing_low) * level
    Level 0.0 = swing_high, Level 1.0 = swing_low
    """
    return swing_high - (swing_high - swing_low) * level


def calc_fib_level(swing_high: float, swing_low: float, price: float) -> float:
    """
    Given a price, return the retracement level as a fraction (0.0 to 1.0+).
    """
    rng = swing_high - swing_low
    if rng == 0:
        return 0.0
    return (swing_high - price) / rng


def classify_setup(fib_level: float) -> Optional[SetupConfig]:
    """
    Given the current Fib retracement level (0.0–1.0+),
    return which setup config matches, or None.
    """
    for setup in SETUPS.values():
        if setup.entry_fib_min <= fib_level <= setup.entry_fib_max:
            return setup
    return None


def analyze_fib_setup(
    ticker: str,
    timeframe: str,
    choch: CHoCH,
    candles: list[Candle],
) -> Optional[DetectedSetup]:
    """
    Main entry point.
    Given a confirmed CHoCH, check if current price is in any of the 4 setup zones.
    Returns a DetectedSetup if found, else None.
    """
    if not candles:
        return None

    swing_high_price = choch.swing_high.price
    swing_low_price = choch.swing_low.price
    current_price = candles[-1].close

    # Only valid if price is between swing low and swing high (retracement phase)
    if current_price > swing_high_price or current_price < swing_low_price * 0.90:
        return None

    fib_level = calc_fib_level(swing_high_price, swing_low_price, current_price)

    setup_config = classify_setup(fib_level)
    if setup_config is None:
        return None

    # Calculate exact entry, SL, and target from setup config
    entry = calc_fib_price(swing_high_price, swing_low_price, setup_config.entry_fib_max)
    stop_loss = calc_fib_price(swing_high_price, swing_low_price, setup_config.sl_fib)
    target = swing_high_price  # target is always back to the swing high (TP = HH)

    # Sanity check
    if entry <= stop_loss or entry >= target:
        return None

    setup_id = f"{ticker}_{setup_config.id}_{timeframe}_{datetime.utcnow().strftime('%Y%m%d%H%M%S')}"

    return DetectedSetup(
        id=setup_id,
        ticker=ticker,
        timeframe=timeframe,
        setup_id=setup_config.id,
        setup_name=setup_config.name,
        choch=choch,
        current_price=current_price,
        entry=entry,
        stop_loss=stop_loss,
        target=target,
        fib_entry_pct=round(fib_level * 100, 1),
        stop_hunt_risk=setup_config.stop_hunt_risk,
        candles=candles,
    )


def get_all_fib_levels(swing_high: float, swing_low: float) -> dict[str, float]:
    """
    Return a dict of all key Fib levels with their prices.
    Used for chart overlay rendering.
    """
    return {
        label: round(calc_fib_price(swing_high, swing_low, level), 4)
        for label, level in FIB_LEVELS.items()
    }
