"""
detectors/candle_patterns.py
Detects the 12 bullish candlestick patterns from the cheat sheet image.

Each pattern returns a dict:
  { name, success_rate, timeframe, strength, description }
or None if not found.

Only looks at the last 3 candles so it's fast and stateless.
"""
from __future__ import annotations
from core.models import Candle


def _body(c: Candle) -> float:
    return abs(c.close - c.open)

def _range(c: Candle) -> float:
    return c.high - c.low if c.high > c.low else 1e-9

def _upper_wick(c: Candle) -> float:
    return c.high - max(c.open, c.close)

def _lower_wick(c: Candle) -> float:
    return min(c.open, c.close) - c.low

def _is_bull(c: Candle) -> bool:
    return c.close > c.open

def _is_bear(c: Candle) -> bool:
    return c.close < c.open

def _body_pct(c: Candle) -> float:
    return _body(c) / _range(c) if _range(c) else 0


# ── Individual pattern checks ────────────────────────────────────────────────

def check_hammer(candles: list[Candle]) -> dict | None:
    c = candles[-1]
    lw = _lower_wick(c)
    uw = _upper_wick(c)
    bd = _body(c)
    if lw >= 2 * bd and uw <= 0.3 * bd and bd > 0:
        return {"name": "Hammer", "success_rate": 65, "strength": "medium",
                "description": "Reversal at the bottom. Long lower wick = rejection of lows."}
    return None

def check_bullish_engulfing(candles: list[Candle]) -> dict | None:
    if len(candles) < 2:
        return None
    prev, curr = candles[-2], candles[-1]
    if _is_bear(prev) and _is_bull(curr) and curr.open < prev.close and curr.close > prev.open:
        return {"name": "Bullish Engulfing", "success_rate": 75, "strength": "high",
                "description": "Strong bullish reversal. Current candle fully engulfs prior bear candle."}
    return None

def check_morning_star(candles: list[Candle]) -> dict | None:
    if len(candles) < 3:
        return None
    a, b, c = candles[-3], candles[-2], candles[-1]
    if (_is_bear(a) and _body(b) < _body(a) * 0.3 and
            _is_bull(c) and c.close > (a.open + a.close) / 2):
        return {"name": "Morning Star", "success_rate": 72, "strength": "high",
                "description": "3-candle bullish trend reversal. Small middle candle = indecision."}
    return None

def check_piercing_line(candles: list[Candle]) -> dict | None:
    if len(candles) < 2:
        return None
    prev, curr = candles[-2], candles[-1]
    midpoint = (prev.open + prev.close) / 2
    if (_is_bear(prev) and _is_bull(curr) and
            curr.open < prev.close and curr.close > midpoint and curr.close < prev.open):
        return {"name": "Piercing Line", "success_rate": 65, "strength": "medium",
                "description": "Reversal signal. Bull candle closes above 50% of prior bear candle."}
    return None

def check_three_white_soldiers(candles: list[Candle]) -> dict | None:
    if len(candles) < 3:
        return None
    a, b, c = candles[-3], candles[-2], candles[-1]
    if (_is_bull(a) and _is_bull(b) and _is_bull(c) and
            b.open > a.open and b.close > a.close and
            c.open > b.open and c.close > b.close and
            _body_pct(a) > 0.5 and _body_pct(b) > 0.5 and _body_pct(c) > 0.5):
        return {"name": "Three White Soldiers", "success_rate": 80, "strength": "very high",
                "description": "Strong bullish pattern. Three consecutive bull candles with rising closes."}
    return None

def check_inverted_hammer(candles: list[Candle]) -> dict | None:
    c = candles[-1]
    uw = _upper_wick(c)
    lw = _lower_wick(c)
    bd = _body(c)
    if uw >= 2 * bd and lw <= 0.3 * bd and bd > 0:
        # Previous candle should be bearish for reversal context
        if len(candles) >= 2 and _is_bear(candles[-2]):
            return {"name": "Inverted Hammer", "success_rate": 65, "strength": "medium",
                    "description": "Reversal signal. Long upper wick shows buyers tried to push price up."}
    return None

def check_bullish_harami(candles: list[Candle]) -> dict | None:
    if len(candles) < 2:
        return None
    prev, curr = candles[-2], candles[-1]
    if (_is_bear(prev) and _is_bull(curr) and
            curr.open > prev.close and curr.close < prev.open and
            _body(curr) < _body(prev) * 0.5):
        return {"name": "Bullish Harami", "success_rate": 65, "strength": "medium",
                "description": "Bullish inside pattern. Small bull candle inside prior bear = slowing momentum."}
    return None

def check_tweezer_bottom(candles: list[Candle]) -> dict | None:
    if len(candles) < 2:
        return None
    prev, curr = candles[-2], candles[-1]
    low_diff = abs(prev.low - curr.low) / prev.low if prev.low else 1
    if _is_bear(prev) and _is_bull(curr) and low_diff < 0.002:
        return {"name": "Tweezer Bottom", "success_rate": 70, "strength": "medium-high",
                "description": "Double bottom reversal. Equal lows show strong support level."}
    return None

def check_marubozu_bull(candles: list[Candle]) -> dict | None:
    c = candles[-1]
    if _is_bull(c) and _body_pct(c) > 0.85:
        return {"name": "Bullish Marubozu", "success_rate": 72, "strength": "high",
                "description": "Strong momentum candle. Almost no wicks = full bull control."}
    return None

def check_dragonfly_doji(candles: list[Candle]) -> dict | None:
    c = candles[-1]
    bd = _body(c)
    lw = _lower_wick(c)
    rng = _range(c)
    if bd / rng < 0.1 and lw > rng * 0.6:
        return {"name": "Dragonfly Doji", "success_rate": 65, "strength": "medium",
                "description": "Bullish reversal signal. Open=Close near high, long lower wick."}
    return None

def check_abandoned_baby(candles: list[Candle]) -> dict | None:
    if len(candles) < 3:
        return None
    a, b, c = candles[-3], candles[-2], candles[-1]
    # Gap down to doji, then gap up bull candle
    doji_body = _body(b) / _range(b) if _range(b) else 1
    if (_is_bear(a) and doji_body < 0.1 and _is_bull(c) and
            b.high < a.low and c.open > b.high):
        return {"name": "Abandoned Baby", "success_rate": 70, "strength": "high",
                "description": "Bullish reversal setup. Gap + doji + gap up = strong reversal signal."}
    return None


# ── Main scanner ─────────────────────────────────────────────────────────────

_CHECKERS = [
    check_hammer,
    check_bullish_engulfing,
    check_morning_star,
    check_piercing_line,
    check_three_white_soldiers,
    check_inverted_hammer,
    check_bullish_harami,
    check_tweezer_bottom,
    check_marubozu_bull,
    check_dragonfly_doji,
    check_abandoned_baby,
]

STRENGTH_ORDER = ["very high", "high", "medium-high", "medium", "low"]


def detect_patterns(candles: list[Candle]) -> list[dict]:
    """
    Run all 11 bullish pattern checks on the last 3 candles.
    Returns a list of matching patterns sorted by success rate descending.
    """
    if not candles or len(candles) < 1:
        return []

    results = []
    for checker in _CHECKERS:
        try:
            result = checker(candles)
            if result:
                results.append(result)
        except Exception:
            pass

    # Sort: highest success rate first
    results.sort(key=lambda x: x.get("success_rate", 0), reverse=True)
    return results[:3]   # return top 3 matches max

