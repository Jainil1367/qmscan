"""
core/models.py
Shared dataclasses and enums used across the entire system.
"""
from __future__ import annotations
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Optional


# ── Candle ───────────────────────────────────────────────────────────────────

@dataclass
class Candle:
    timestamp: datetime
    open: float
    high: float
    low: float
    close: float
    volume: float
    vwap: float = 0.0

    @property
    def body(self) -> float:
        return abs(self.close - self.open)

    @property
    def is_bullish(self) -> bool:
        return self.close > self.open

    @property
    def upper_wick(self) -> float:
        return self.high - max(self.open, self.close)

    @property
    def lower_wick(self) -> float:
        return min(self.open, self.close) - self.low

    def to_dict(self) -> dict:
        return {
            "t": self.timestamp.isoformat(),
            "o": round(self.open, 4),
            "h": round(self.high, 4),
            "l": round(self.low, 4),
            "c": round(self.close, 4),
            "v": round(self.volume, 0),
            "vw": round(self.vwap, 4),
        }


# ── Swing Point ──────────────────────────────────────────────────────────────

class SwingType(Enum):
    HIGH = "HH"
    LOW = "LL"


@dataclass
class SwingPoint:
    index: int
    price: float
    timestamp: datetime
    swing_type: SwingType

    def to_dict(self) -> dict:
        return {
            "index": self.index,
            "price": round(self.price, 4),
            "timestamp": self.timestamp.isoformat(),
            "type": self.swing_type.value,
        }


# ── CHoCH ────────────────────────────────────────────────────────────────────

@dataclass
class CHoCH:
    """Change of Character — market structure shift."""
    confirmed_at: datetime
    direction: str          # "bullish" | "bearish"
    broken_level: float     # the level that was broken
    swing_high: SwingPoint
    swing_low: SwingPoint
    impulse_pct: float      # size of the impulsive move in %

    def to_dict(self) -> dict:
        return {
            "confirmed_at": self.confirmed_at.isoformat(),
            "direction": self.direction,
            "broken_level": round(self.broken_level, 4),
            "swing_high": self.swing_high.to_dict(),
            "swing_low": self.swing_low.to_dict(),
            "impulse_pct": round(self.impulse_pct, 2),
        }


# ── Order Block ──────────────────────────────────────────────────────────────

@dataclass
class OrderBlock:
    index: int
    timestamp: datetime
    ob_type: str        # "bullish" | "bearish"
    top: float
    bottom: float
    candle: Candle
    age_bars: int = 0
    mitigated: bool = False

    @property
    def midpoint(self) -> float:
        return (self.top + self.bottom) / 2

    def contains_price(self, price: float) -> bool:
        return self.bottom <= price <= self.top

    def to_dict(self) -> dict:
        return {
            "index": self.index,
            "timestamp": self.timestamp.isoformat(),
            "type": self.ob_type,
            "top": round(self.top, 4),
            "bottom": round(self.bottom, 4),
            "midpoint": round(self.midpoint, 4),
            "age_bars": self.age_bars,
            "mitigated": self.mitigated,
        }


# ── Detected Setup ───────────────────────────────────────────────────────────

@dataclass
class DetectedSetup:
    id: str                     # unique: AAPL_3_15m_<timestamp>
    ticker: str
    timeframe: str
    setup_id: int               # 1–4
    setup_name: str
    choch: CHoCH
    current_price: float
    entry: float
    stop_loss: float
    target: float
    fib_entry_pct: float        # actual fib level price is at
    order_block: Optional[OrderBlock] = None
    htf_confluent: bool = False
    htf_trend: str = "unknown"  # "bullish" | "bearish" | "unknown"
    stop_hunt_risk: bool = False
    detected_at: datetime = field(default_factory=datetime.utcnow)
    candles: list[Candle] = field(default_factory=list)
    # computed
    risk_reward: float = 0.0
    risk_pct: float = 0.0
    # extra chart levels
    htf_key_level: float = 0.0      # HTF significant level (prev swing high on HTF)
    htf_lq: float = 0.0             # HTF liquidity (prev swing low on HTF)
    stop_hunt_level: float = 0.0    # level below swing low where stop hunt likely
    hh1: float = 0.0                # previous swing high before current HH

    def __post_init__(self):
        risk = self.entry - self.stop_loss
        reward = self.target - self.entry
        self.risk_reward = round(reward / risk, 2) if risk > 0 else 0.0
        self.risk_pct = round(abs(risk) / self.entry * 100, 2)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "ticker": self.ticker,
            "timeframe": self.timeframe,
            "setup_id": self.setup_id,
            "setup_name": self.setup_name,
            "choch": self.choch.to_dict(),
            "current_price": round(self.current_price, 4),
            "entry": round(self.entry, 4),
            "stop_loss": round(self.stop_loss, 4),
            "target": round(self.target, 4),
            "fib_entry_pct": round(self.fib_entry_pct, 1),
            "order_block": self.order_block.to_dict() if self.order_block else None,
            "htf_confluent": self.htf_confluent,
            "htf_trend": self.htf_trend,
            "stop_hunt_risk": self.stop_hunt_risk,
            "detected_at": self.detected_at.isoformat(),
            "risk_reward": self.risk_reward,
            "risk_pct": self.risk_pct,
            "htf_key_level": round(self.htf_key_level, 4),
            "htf_lq": round(self.htf_lq, 4),
            "stop_hunt_level": round(self.stop_hunt_level, 4),
            "hh1": round(self.hh1, 4),
            "candles": [c.to_dict() for c in self.candles[-60:]],
        }


# ── Alert ────────────────────────────────────────────────────────────────────

class AlertSeverity(Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


@dataclass
class Alert:
    id: str
    ticker: str
    timeframe: str
    setup_id: int
    setup_name: str
    message: str
    severity: AlertSeverity
    entry: float
    stop_loss: float
    target: float
    risk_reward: float
    htf_confluent: bool
    order_block_present: bool
    created_at: datetime = field(default_factory=datetime.utcnow)
    acknowledged: bool = False

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "ticker": self.ticker,
            "timeframe": self.timeframe,
            "setup_id": self.setup_id,
            "setup_name": self.setup_name,
            "message": self.message,
            "severity": self.severity.value,
            "entry": round(self.entry, 4),
            "stop_loss": round(self.stop_loss, 4),
            "target": round(self.target, 4),
            "risk_reward": self.risk_reward,
            "htf_confluent": self.htf_confluent,
            "order_block_present": self.order_block_present,
            "created_at": self.created_at.isoformat(),
            "acknowledged": self.acknowledged,
        }


# ── Trade Log Entry ──────────────────────────────────────────────────────────

class TradeStatus(Enum):
    PENDING = "pending"
    OPEN = "open"
    CLOSED_WIN = "closed_win"
    CLOSED_LOSS = "closed_loss"
    CLOSED_BE = "closed_be"
    CANCELLED = "cancelled"


@dataclass
class Trade:
    id: str
    ticker: str
    timeframe: str
    setup_id: int
    setup_name: str
    entry: float
    stop_loss: float
    target: float
    risk_reward: float
    risk_pct: float
    account_size: float
    position_size: float        # shares/units
    risk_amount: float          # $ at risk
    status: TradeStatus = TradeStatus.PENDING
    open_price: Optional[float] = None
    close_price: Optional[float] = None
    pnl: float = 0.0
    pnl_r: float = 0.0         # P&L in R multiples
    opened_at: Optional[datetime] = None
    closed_at: Optional[datetime] = None
    created_at: datetime = field(default_factory=datetime.utcnow)
    notes: str = ""
    htf_confluent: bool = False
    order_block: bool = False

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "ticker": self.ticker,
            "timeframe": self.timeframe,
            "setup_id": self.setup_id,
            "setup_name": self.setup_name,
            "entry": round(self.entry, 4),
            "stop_loss": round(self.stop_loss, 4),
            "target": round(self.target, 4),
            "risk_reward": self.risk_reward,
            "risk_pct": self.risk_pct,
            "account_size": round(self.account_size, 2),
            "position_size": round(self.position_size, 4),
            "risk_amount": round(self.risk_amount, 2),
            "status": self.status.value,
            "open_price": round(self.open_price, 4) if self.open_price else None,
            "close_price": round(self.close_price, 4) if self.close_price else None,
            "pnl": round(self.pnl, 2),
            "pnl_r": round(self.pnl_r, 2),
            "opened_at": self.opened_at.isoformat() if self.opened_at else None,
            "closed_at": self.closed_at.isoformat() if self.closed_at else None,
            "created_at": self.created_at.isoformat(),
            "notes": self.notes,
            "htf_confluent": self.htf_confluent,
            "order_block": self.order_block,
        }
