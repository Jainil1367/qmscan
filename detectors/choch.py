"""
detectors/choch.py
Change of Character (CHoCH) detector.

ICT Definition:
  - Find a significant swing high and swing low (the impulsive leg)
  - A bullish CHoCH: after a down-move (swing high -> swing low),
    price breaks back ABOVE the swing high origin (CHoCH level)
  - We look for the most recent completed pullback into a fib zone
    after any impulsive move, regardless of strict trend structure
"""
from __future__ import annotations
from typing import Optional
from core.models import Candle, SwingPoint, SwingType, CHoCH
from core.config import CHOCH_LOOKBACK, SWING_STRENGTH, MIN_SWING_SIZE_PCT


def find_swing_points(
    candles: list[Candle],
    strength: int = SWING_STRENGTH,
) -> list[SwingPoint]:
    """
    Identify swing highs and lows using pivot detection.
    A swing high: candle[i].high is the highest among strength bars left and right.
    A swing low:  candle[i].low  is the lowest  among strength bars left and right.
    """
    swings: list[SwingPoint] = []
    n = len(candles)
    for i in range(strength, n - strength):
        window_highs = [candles[j].high for j in range(i - strength, i + strength + 1)]
        window_lows  = [candles[j].low  for j in range(i - strength, i + strength + 1)]
        if candles[i].high == max(window_highs):
            swings.append(SwingPoint(
                index=i,
                price=candles[i].high,
                timestamp=candles[i].timestamp,
                swing_type=SwingType.HIGH,
            ))
        elif candles[i].low == min(window_lows):
            swings.append(SwingPoint(
                index=i,
                price=candles[i].low,
                timestamp=candles[i].timestamp,
                swing_type=SwingType.LOW,
            ))
    return swings


def detect_choch(
    candles: list[Candle],
    lookback: int = CHOCH_LOOKBACK,
) -> Optional[CHoCH]:
    """
    Bullish CHoCH: find the most recent significant swing high followed by a
    swing low (pullback), where current price is between the swing low and
    swing high (retracement phase). This signals a potential long setup.

    Returns the most recent valid CHoCH or None.
    """
    if len(candles) < lookback + SWING_STRENGTH * 2:
        return None

    recent = candles[-(lookback + SWING_STRENGTH * 2):]
    swings = find_swing_points(recent, strength=SWING_STRENGTH)

    if len(swings) < 2:
        return None

    highs = [s for s in swings if s.swing_type == SwingType.HIGH]
    lows  = [s for s in swings if s.swing_type == SwingType.LOW]

    if not highs or not lows:
        return None

    current_close = candles[-1].close

    # Try each swing high (most recent first) looking for a valid setup
    for swing_high in reversed(highs):
        # Find the most recent swing low that occurred AFTER this swing high
        subsequent_lows = [l for l in lows if l.index > swing_high.index]
        if not subsequent_lows:
            continue
        swing_low = subsequent_lows[-1]  # most recent low after the high

        # Validate impulse size
        impulse_size = (swing_high.price - swing_low.price) / swing_low.price
        if impulse_size < MIN_SWING_SIZE_PCT:
            continue

        # Current price must be retracing (between swing low and swing high)
        if not (swing_low.price <= current_close <= swing_high.price):
            continue

        # This is a valid bullish CHoCH setup — price pulled back from a swing high
        return CHoCH(
            confirmed_at=candles[-1].timestamp,
            direction="bullish",
            broken_level=swing_high.price,
            swing_high=swing_high,
            swing_low=swing_low,
            impulse_pct=round(impulse_size * 100, 2),
        )

    return None


def get_recent_swing_range(
    candles: list[Candle],
    lookback: int = CHOCH_LOOKBACK,
) -> Optional[tuple[SwingPoint, SwingPoint]]:
    """Return the most recent (swing_high, swing_low) pair."""
    if len(candles) < lookback:
        return None
    recent = candles[-lookback:]
    swings = find_swing_points(recent, strength=SWING_STRENGTH)
    highs = [s for s in swings if s.swing_type == SwingType.HIGH]
    lows  = [s for s in swings if s.swing_type == SwingType.LOW]
    if not highs or not lows:
        return None
    return highs[-1], lows[-1]
