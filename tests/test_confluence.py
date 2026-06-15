"""
tests/test_confluence.py
Unit tests for HTF confluence checker.
"""
import sys
sys.path.insert(0, str(__file__).split('/tests/')[0])

from datetime import datetime, timedelta
from core.models import Candle
from detectors.htf_confluence import calc_ema, determine_trend, check_htf_confluence


def make_trending_candles(n: int, direction: str = "up") -> list[Candle]:
    candles = []
    price = 100.0
    for i in range(n):
        if direction == "up":
            price *= 1.003
        else:
            price *= 0.997
        spread = price * 0.003
        candles.append(Candle(
            timestamp=datetime.utcnow() + timedelta(hours=i),
            open=price - spread,
            high=price + spread,
            low=price - spread * 1.5,
            close=price + spread,
            volume=50_000,
        ))
    return candles


def test_ema_length():
    closes = list(range(1, 101))
    ema = calc_ema(closes, 50)
    assert len(ema) == 100


def test_ema_last_value_reasonable():
    """EMA of steadily increasing series should be below the last value."""
    closes = [float(i) for i in range(1, 101)]
    ema = calc_ema(closes, 50)
    assert ema[-1] < closes[-1]
    assert ema[-1] > closes[0]


def test_uptrend_detected():
    candles = make_trending_candles(100, "up")
    trend = determine_trend(candles)
    assert trend == "bullish"


def test_downtrend_detected():
    candles = make_trending_candles(100, "down")
    trend = determine_trend(candles)
    assert trend in ["bearish", "neutral"]


def test_htf_confluence_bullish():
    candles = make_trending_candles(100, "up")
    confluent, trend = check_htf_confluence("15m", candles)
    assert confluent is True
    assert trend == "bullish"


def test_htf_confluence_too_few_candles():
    candles = make_trending_candles(5, "up")
    confluent, trend = check_htf_confluence("15m", candles)
    assert confluent is False
    assert trend == "unknown"


def test_htf_none_candles():
    confluent, trend = check_htf_confluence("15m", None)
    assert confluent is False
    assert trend == "unknown"


if __name__ == "__main__":
    import pytest
    pytest.main([__file__, "-v"])
