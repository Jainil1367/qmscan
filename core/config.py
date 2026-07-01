"""core/config.py — All configuration and Fibonacci setup definitions."""
from __future__ import annotations
import os
from dataclasses import dataclass
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

FINNHUB_API_KEY: str = os.getenv("FINNHUB_API_KEY", "")
DATA_PROVIDER: str = "yfinance"
HOST: str = os.getenv("HOST", "0.0.0.0")
PORT: int = int(os.getenv("PORT", "10000"))

SCAN_INTERVAL: int = int(os.getenv("SCAN_INTERVAL_SECONDS", "90"))
UNIVERSE_SIZE: int = int(os.getenv("UNIVERSE_SIZE", "51"))
SCAN_BATCH_SIZE: int = int(os.getenv("SCAN_BATCH_SIZE", "5"))
SCAN_BATCH_DELAY: float = float(os.getenv("SCAN_BATCH_DELAY", "1.5"))
ENABLE_SOUND_ALERTS: bool = os.getenv("ENABLE_SOUND_ALERTS", "false").lower() == "true"
ENABLE_PUSH_ALERTS: bool = os.getenv("ENABLE_PUSH_ALERTS", "false").lower() == "true"
ALERT_COOLDOWN_SECONDS: int = int(os.getenv("ALERT_COOLDOWN_SECONDS", "300"))

# ── Timeframes: 1H, 4H, 1D, 1W ───────────────────────────────────────────────
TIMEFRAMES: dict[str, dict] = {
    "1H": {"multiplier": 1, "timespan": "hour", "bars": 200, "label": "1 Hour"},
    "4H": {"multiplier": 4, "timespan": "hour", "bars": 200, "label": "4 Hour"},
    "1D": {"multiplier": 1, "timespan": "day",  "bars": 200, "label": "Daily"},
    "1W": {"multiplier": 1, "timespan": "week", "bars": 100, "label": "Weekly"},
}

YFINANCE_TIMEFRAME_MAP: dict[str, str] = {
    "1H": "1h",
    "4H": "1h",    # fetched as 1H then resampled to 4H
    "1D": "1d",
    "1W": "1wk",
}

HTF_PAIRS: dict[str, str] = {
    "1H": "4H",
    "4H": "1D",
    "1D": "1W",
    "1W": "1W",
}

# ── Fibonacci Setups 1-4 (no master) ─────────────────────────────────────────
@dataclass
class SetupConfig:
    id: int
    name: str
    short: str
    entry_fib_min: float
    entry_fib_max: float
    sl_fib: float
    target_fib: float = 1.0
    requires_ob: bool = False
    stop_hunt_risk: bool = False
    color: str = "#ffffff"
    description: str = ""

SETUPS: dict[int, SetupConfig] = {
    1: SetupConfig(
        id=1, name="Impulsive Move", short="Impulsive",
        entry_fib_min=0.35, entry_fib_max=0.42, sl_fib=0.618,
        color="#0ea5e9",
        description="Fast snap to 38.2%. Strong impulsive move required. Highest velocity, lowest R/R.",
    ),
    2: SetupConfig(
        id=2, name="Typical Correction", short="Typical",
        entry_fib_min=0.50, entry_fib_max=0.65, sl_fib=0.886,
        color="#a855f7",
        description="50–61.8% retracement. Most common ICT setup. Good R/R with tight SL at 88.6%.",
    ),
    3: SetupConfig(
        id=3, name="Golden Zone", short="Golden",
        entry_fib_min=0.75, entry_fib_max=0.82, sl_fib=1.13,
        requires_ob=True, color="#f59e0b",
        description="78.6% golden pocket. Requires Order Block confluence. Highest probability setup.",
    ),
    4: SetupConfig(
        id=4, name="Deep Correction", short="Deep",
        entry_fib_min=0.84, entry_fib_max=0.92, sl_fib=1.13,
        stop_hunt_risk=True, color="#ef4444",
        description="88.6% retracement. Stop hunt below swing low likely before reversal. Wide SL.",
    ),
}

CHOCH_LOOKBACK: int = 20
SWING_STRENGTH: int = 3
MIN_SWING_SIZE_PCT: float = 0.02

OB_LOOKBACK: int = 50
OB_MIN_BODY_PCT: float = 0.003
OB_MAX_AGE_BARS: int = 40

HTF_TREND_LOOKBACK: int = 50
HTF_REQUIRED: bool = True

DEFAULT_RISK_PCT: float = 1.0
DEFAULT_ACCOUNT_SIZE: float = 10_000.0