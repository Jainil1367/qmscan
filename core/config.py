"""
core/config.py
All configuration, constants, and Fibonacci setup definitions.
Edit this file to tune detection sensitivity.
"""
from __future__ import annotations
import os
from dataclasses import dataclass, field
from dotenv import load_dotenv

load_dotenv()


# ── API Keys ────────────────────────────────────────────────────────────────

FINNHUB_API_KEY: str = os.getenv("FINNHUB_API_KEY", "d8mbu6hr01qkiso7u2k0d8mbu6hr01qkiso7u2kg")
DATA_PROVIDER: str = "yfinance"

# ── Server ───────────────────────────────────────────────────────────────────

HOST: str = os.getenv("HOST", "0.0.0.0")
PORT: int = int(os.getenv("PORT", "8000"))

# ── Scanner ──────────────────────────────────────────────────────────────────

SCAN_INTERVAL: int = int(os.getenv("SCAN_INTERVAL_SECONDS", "60"))
UNIVERSE_SIZE: int = int(os.getenv("UNIVERSE_SIZE", "51"))
ENABLE_SOUND_ALERTS: bool = os.getenv("ENABLE_SOUND_ALERTS", "true").lower() == "true"
ENABLE_PUSH_ALERTS: bool = os.getenv("ENABLE_PUSH_ALERTS", "true").lower() == "true"

# ── Timeframes ───────────────────────────────────────────────────────────────

# Maps UI label → (Polygon multiplier, Polygon timespan, candle count to fetch)
TIMEFRAMES: dict[str, dict] = {
    "15m": {"multiplier": 15, "timespan": "minute", "bars": 200, "label": "15 Min"},
    "1H":  {"multiplier": 1,  "timespan": "hour",   "bars": 200, "label": "1 Hour"},
    "1D":  {"multiplier": 1,  "timespan": "day",    "bars": 200, "label": "Daily"},
    "1W":  {"multiplier": 1,  "timespan": "week",   "bars": 100, "label": "Weekly"},
}

# yfinance interval codes
YFINANCE_TIMEFRAME_MAP: dict[str, str] = {
    "15m": "15m",
    "1H":  "1h",
    "1D":  "1d",
    "1W":  "1wk",
}

# HTF pairs: when scanning TF X, check alignment on TF Y
HTF_PAIRS: dict[str, str] = {
    "15m": "1H",
    "1H":  "1D",
    "1D":  "1W",
    "1W":  "1W",
}

# ── Fibonacci Setup Definitions (from image) ─────────────────────────────────

@dataclass
class SetupConfig:
    id: int
    name: str
    short: str
    # Fib entry zone (min, max as fraction of swing range)
    entry_fib_min: float
    entry_fib_max: float
    # Stop loss Fib level (fraction of swing range below swing high)
    sl_fib: float
    # Target = swing high (1.0)
    target_fib: float = 1.0
    # Requires Order Block confluence
    requires_ob: bool = False
    # Stop hunt warning
    stop_hunt_risk: bool = False
    color: str = "#ffffff"
    description: str = ""


SETUPS: dict[int, SetupConfig] = {
    1: SetupConfig(
        id=1,
        name="Impulsive Move",
        short="Impulsive",
        entry_fib_min=0.35,
        entry_fib_max=0.42,
        sl_fib=0.618,
        color="#0ea5e9",
        description="Fast retracement to 38.2% after strong impulsive move with CHoCH.",
    ),
    2: SetupConfig(
        id=2,
        name="Typical Correction",
        short="Typical",
        entry_fib_min=0.50,
        entry_fib_max=0.65,
        sl_fib=0.886,
        color="#a855f7",
        description="Standard pullback to 50–61.8% zone. Most common setup.",
    ),
    3: SetupConfig(
        id=3,
        name="Golden Zone",
        short="Golden",
        entry_fib_min=0.75,
        entry_fib_max=0.82,
        sl_fib=1.13,
        requires_ob=True,
        color="#f59e0b",
        description="Deep retracement to 78.6% with Order Block confluence. Best R/R.",
    ),
    4: SetupConfig(
        id=4,
        name="Deep Correction",
        short="Deep",
        entry_fib_min=0.84,
        entry_fib_max=0.92,
        sl_fib=1.13,
        stop_hunt_risk=True,
        color="#ef4444",
        description="88.6% retracement — stop hunt below structure likely before reversal.",
    ),
    5: SetupConfig(
        id=5,
        name="Master Setup",
        short="Master",
        entry_fib_min=0.35,
        entry_fib_max=0.92,
        sl_fib=1.13,
        requires_ob=False,
        stop_hunt_risk=False,
        color="#22d3ee",
        description="Multi-timeframe confluence: stock has ICT setups active on 2+ timeframes simultaneously.",
    ),
}

# ── CHoCH Detection ──────────────────────────────────────────────────────────

CHOCH_LOOKBACK: int = 20        # bars to look back for swing points
SWING_STRENGTH: int = 3         # bars each side to confirm a swing high/low
MIN_SWING_SIZE_PCT: float = 0.02  # swing must be at least 2% of price

# ── Order Block Detection ────────────────────────────────────────────────────

OB_LOOKBACK: int = 50           # bars to look back for OBs
OB_MIN_BODY_PCT: float = 0.003  # OB candle body must be ≥0.3% of price
OB_MAX_AGE_BARS: int = 40       # discard OBs older than this

# ── HTF Confluence ───────────────────────────────────────────────────────────

HTF_TREND_LOOKBACK: int = 50    # bars for HTF trend direction
HTF_REQUIRED: bool = True       # require HTF alignment to show setup

# ── Risk / Trade Defaults ────────────────────────────────────────────────────

DEFAULT_RISK_PCT: float = 1.0   # % of account risked per trade (for trade log)
DEFAULT_ACCOUNT_SIZE: float = 10_000.0

# ── Alert Cooldown ───────────────────────────────────────────────────────────

ALERT_COOLDOWN_SECONDS: int = 300  # don't re-alert same symbol+setup for 5 min
