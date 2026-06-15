"""
tests/test_choch.py
Unit tests for CHoCH detection.
"""
import sys
sys.path.insert(0, str(__file__).split('/tests/')[0])

from datetime import datetime, timedelta
from core.models import Candle
from detectors.choch import find_swing_points, detect_choch, SwingType


def make_candle(price: float, idx: int = 0, bullish: bool = True) -> Candle:
    now = datetime.utcnow() + timedelta(minutes=idx * 15)
    spread = price * 0.005
    return Candle(
        timestamp=now,
        open=price - spread if bullish else price + spread,
        high=price + spread,
        low=price - spread,
        close=price + spread if bullish else price - spread,
        volume=100_000,
    )


def make_downtrend_then_break(n: int = 60) -> list[Candle]:
    """
    Creates a downtrend (LH, LL sequence) then a breakout (bullish CHoCH).
    Prices: 120, 110, 105, 115, 100, 108, 95, 106 (breaks above 106)
    """
    prices = []
    # Downtrend with LH, LL pattern
    base = 120
    for i in range(40):
        # Oscillate downward
        if i % 8 < 4:
            prices.append(base - i * 0.5)
        else:
            prices.append(base - i * 0.5 + 3)

    # Break above previous lower high
    for i in range(20):
        prices.append(prices[-1] + 0.8)

    candles = []
    for idx, p in enumerate(prices[:n]):
        candles.append(make_candle(p, idx, bullish=(p > (prices[idx-1] if idx > 0 else p))))

    return candles


def test_swing_points_detected():
    """Should find at least 2 swings in a trending series."""
    candles = make_downtrend_then_break(60)
    swings = find_swing_points(candles, strength=3)
    assert len(swings) >= 2


def test_swing_types():
    """Swing types should be HIGH or LOW."""
    candles = make_downtrend_then_break(60)
    swings = find_swing_points(candles, strength=3)
    for s in swings:
        assert s.swing_type in [SwingType.HIGH, SwingType.LOW]


def test_choch_on_flat_data_is_none():
    """Flat price series should not produce a CHoCH."""
    candles = [make_candle(100, i) for i in range(60)]
    result = detect_choch(candles)
    assert result is None


def test_choch_needs_minimum_candles():
    """Less than 30 candles → None."""
    candles = [make_candle(100, i) for i in range(10)]
    result = detect_choch(candles)
    assert result is None


if __name__ == "__main__":
    import pytest
    pytest.main([__file__, "-v"])
