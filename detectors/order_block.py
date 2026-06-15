"""
detectors/order_block.py
Order Block (OB) detector — primarily used to confirm Setup 3 (Golden Zone).

An Order Block is the last opposing candle before a strong impulsive move.

BULLISH OB: The last BEARISH candle before a strong bullish impulse.
  - Price returning to this zone = institutional demand area
  - Confirmed when price revisits the body of that bearish candle

Detection logic:
  1. Find a strong bullish impulse leg (3+ consecutive bullish candles, significant range)
  2. The candle immediately before the impulse = bullish OB
  3. OB zone = body of that candle (open to close for bearish candle = top to bottom)
  4. Mark as mitigated if price has already traded through it
"""
from __future__ import annotations
from typing import Optional
from core.models import Candle, OrderBlock
from core.config import OB_LOOKBACK, OB_MIN_BODY_PCT, OB_MAX_AGE_BARS


def _is_strong_impulse(candles: list[Candle], start: int, min_consecutive: int = 2) -> bool:
    """Check if there's a strong bullish impulse starting at `start`."""
    if start + min_consecutive >= len(candles):
        return False
    bullish_count = 0
    for i in range(start, min(start + min_consecutive + 1, len(candles))):
        if candles[i].close > candles[i].open:
            bullish_count += 1
    return bullish_count >= min_consecutive


def find_order_blocks(
    candles: list[Candle],
    lookback: int = OB_LOOKBACK,
) -> list[OrderBlock]:
    """
    Scan the last `lookback` candles for bullish Order Blocks.
    Returns list sorted by recency (most recent first).
    """
    if len(candles) < lookback:
        return []

    recent = candles[-lookback:]
    obs: list[OrderBlock] = []
    current_price = candles[-1].close

    for i in range(len(recent) - 3):
        candle = recent[i]

        # OB candidate: bearish candle
        if candle.close >= candle.open:
            continue

        body_size = candle.open - candle.close  # bearish: open > close
        if body_size / candle.close < OB_MIN_BODY_PCT:
            continue

        # Check for strong bullish impulse after this candle
        if not _is_strong_impulse(recent, i + 1):
            continue

        top = candle.open      # top of OB = open of bearish candle
        bottom = candle.close  # bottom of OB = close of bearish candle

        age = len(recent) - 1 - i
        if age > OB_MAX_AGE_BARS:
            continue

        # Check if mitigated (price already traded into the OB body previously)
        mitigated = False
        for future_candle in recent[i + 1:]:
            if future_candle.low <= top and future_candle.close < bottom:
                mitigated = True
                break

        obs.append(OrderBlock(
            index=i,
            timestamp=candle.timestamp,
            ob_type="bullish",
            top=top,
            bottom=bottom,
            candle=candle,
            age_bars=age,
            mitigated=mitigated,
        ))

    # Sort most recent first, filter mitigated
    obs = [ob for ob in obs if not ob.mitigated]
    obs.sort(key=lambda o: o.index, reverse=True)
    return obs


def find_ob_at_price(
    candles: list[Candle],
    price: float,
    tolerance_pct: float = 0.005,
) -> Optional[OrderBlock]:
    """
    Find an unmitigated bullish OB that the given price is currently trading into.
    Used to confirm Setup 3 (Golden Zone requires OB confluence).
    `tolerance_pct` — how far outside the OB zone price can be and still count.
    """
    obs = find_order_blocks(candles)
    for ob in obs:
        expanded_top = ob.top * (1 + tolerance_pct)
        expanded_bottom = ob.bottom * (1 - tolerance_pct)
        if expanded_bottom <= price <= expanded_top:
            return ob
    return None
