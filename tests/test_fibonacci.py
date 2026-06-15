"""
tests/test_fibonacci.py
Unit tests for Fibonacci setup classification.
Run: python -m pytest tests/ -v
"""
import sys
sys.path.insert(0, str(__file__).split('/tests/')[0])

from datetime import datetime
from core.models import Candle, SwingPoint, SwingType, CHoCH
from detectors.fibonacci import (
    calc_fib_price, calc_fib_level, classify_setup, get_all_fib_levels
)


def make_choch(high: float, low: float) -> CHoCH:
    now = datetime.utcnow()
    return CHoCH(
        confirmed_at=now,
        direction="bullish",
        broken_level=high * 0.99,
        swing_high=SwingPoint(0, high, now, SwingType.HIGH),
        swing_low=SwingPoint(5, low, now, SwingType.LOW),
        impulse_pct=((high - low) / low) * 100,
    )


def test_fib_price_at_382():
    price = calc_fib_price(200, 100, 0.382)
    assert abs(price - 161.8) < 0.01


def test_fib_price_at_0_is_high():
    assert calc_fib_price(200, 100, 0.0) == 200.0


def test_fib_price_at_1_is_low():
    assert calc_fib_price(200, 100, 1.0) == 100.0


def test_calc_level_at_382():
    level = calc_fib_level(200, 100, 161.8)
    assert abs(level - 0.382) < 0.01


def test_setup1_classification():
    """Price at 38.2% should be Setup 1."""
    fib = 0.382
    setup = classify_setup(fib)
    assert setup is not None
    assert setup.id == 1


def test_setup2_classification():
    """Price at 61.8% should be Setup 2."""
    setup = classify_setup(0.618)
    assert setup is not None
    assert setup.id == 2


def test_setup3_classification():
    """Price at 78.6% should be Setup 3."""
    setup = classify_setup(0.786)
    assert setup is not None
    assert setup.id == 3


def test_setup4_classification():
    """Price at 88.6% should be Setup 4."""
    setup = classify_setup(0.886)
    assert setup is not None
    assert setup.id == 4


def test_no_setup_outside_zones():
    """Price at 10% retracement — no setup."""
    setup = classify_setup(0.10)
    assert setup is None


def test_all_fib_levels():
    levels = get_all_fib_levels(200, 100)
    assert levels["0.0"] == 200.0
    assert levels["100.0"] == 100.0
    assert abs(levels["61.8"] - 138.2) < 0.1


if __name__ == "__main__":
    import pytest
    pytest.main([__file__, "-v"])
