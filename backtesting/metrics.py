"""backtesting/metrics.py — Performance metrics from a list of BacktestTrade objects."""
from __future__ import annotations
import math
from dataclasses import dataclass, field


@dataclass
class BacktestTrade:
    ticker: str
    timeframe: str
    setup_id: int
    setup_name: str
    entry_bar: int
    entry_price: float
    stop_loss: float
    target: float
    fib_entry_pct: float
    htf_confluent: bool
    order_block: bool
    swing_high: float
    swing_low: float
    exit_price: float = 0.0
    exit_bar: int = 0
    outcome: str = "open"
    r_multiple: float = 0.0
    bars_held: int = 0
    entry_date: str = ""
    exit_date: str = ""
    candle_patterns: list = field(default_factory=list)


@dataclass
class BacktestMetrics:
    total_trades: int = 0
    wins: int = 0
    losses: int = 0
    win_rate: float = 0.0
    avg_r: float = 0.0
    total_r: float = 0.0
    profit_factor: float = 0.0
    max_drawdown: float = 0.0
    max_drawdown_pct: float = 0.0
    sharpe_ratio: float = 0.0
    avg_bars_held: float = 0.0
    best_trade_r: float = 0.0
    worst_trade_r: float = 0.0
    equity_curve: list = field(default_factory=list)
    by_setup: dict = field(default_factory=dict)
    by_timeframe: dict = field(default_factory=dict)
    by_ticker: dict = field(default_factory=dict)
    monthly_returns: list = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "total_trades":     self.total_trades,
            "wins":             self.wins,
            "losses":           self.losses,
            "win_rate":         round(self.win_rate, 2),
            "avg_r":            round(self.avg_r, 3),
            "total_r":          round(self.total_r, 3),
            "profit_factor":    round(self.profit_factor, 3) if self.profit_factor != float("inf") else 999,
            "max_drawdown":     round(self.max_drawdown, 3),
            "max_drawdown_pct": round(self.max_drawdown_pct, 2),
            "sharpe_ratio":     round(self.sharpe_ratio, 3),
            "avg_bars_held":    round(self.avg_bars_held, 1),
            "best_trade_r":     round(self.best_trade_r, 3),
            "worst_trade_r":    round(self.worst_trade_r, 3),
            "equity_curve":     self.equity_curve,
            "by_setup":         self.by_setup,
            "by_timeframe":     self.by_timeframe,
            "by_ticker":        self.by_ticker,
            "monthly_returns":  self.monthly_returns,
        }


def compute_metrics(trades: list[BacktestTrade], initial_equity: float = 10_000.0) -> BacktestMetrics:
    m = BacktestMetrics()
    closed = [t for t in trades if t.outcome in ("win", "loss", "max_bars")]
    if not closed:
        return m

    closed.sort(key=lambda t: t.entry_date)
    m.total_trades = len(closed)
    m.wins   = sum(1 for t in closed if t.outcome == "win")
    m.losses = m.total_trades - m.wins
    m.win_rate = m.wins / m.total_trades * 100

    r_list = [t.r_multiple for t in closed]
    m.avg_r  = sum(r_list) / len(r_list)
    m.total_r = sum(r_list)
    m.best_trade_r  = max(r_list)
    m.worst_trade_r = min(r_list)
    m.avg_bars_held = sum(t.bars_held for t in closed) / len(closed)

    gross_win  = sum(r for r in r_list if r > 0)
    gross_loss = abs(sum(r for r in r_list if r < 0))
    m.profit_factor = (gross_win / gross_loss) if gross_loss > 0 else float("inf")

    # Equity curve
    equity = initial_equity
    peak   = equity
    max_dd = 0.0
    curve  = [round(equity, 2)]
    risk_pct = 0.01

    for t in closed:
        risk_pts = t.entry_price - t.stop_loss
        if risk_pts <= 0:
            continue
        risk_amt = equity * risk_pct
        pnl = t.r_multiple * risk_amt
        equity = max(0.01, equity + pnl)
        curve.append(round(equity, 2))
        if equity > peak:
            peak = equity
        dd = (peak - equity) / peak * 100
        if dd > max_dd:
            max_dd = dd

    m.equity_curve = curve
    m.max_drawdown_pct = round(max_dd, 2)
    m.max_drawdown = round((max_dd / 100) * initial_equity, 2)

    # Sharpe
    if len(r_list) > 1:
        mean_r = m.avg_r
        std_r  = math.sqrt(sum((r - mean_r) ** 2 for r in r_list) / len(r_list))
        m.sharpe_ratio = (mean_r / std_r * math.sqrt(252)) if std_r > 0 else 0.0

    # By setup
    sg: dict[int, list] = {}
    for t in closed:
        sg.setdefault(t.setup_id, []).append(t)
    for sid, grp in sg.items():
        rs  = [t.r_multiple for t in grp]
        w   = sum(1 for t in grp if t.outcome == "win")
        gw  = sum(r for r in rs if r > 0)
        gl  = abs(sum(r for r in rs if r < 0))
        m.by_setup[sid] = {
            "name":          grp[0].setup_name,
            "total":         len(grp),
            "wins":          w,
            "win_rate":      round(w / len(grp) * 100, 1),
            "avg_r":         round(sum(rs) / len(rs), 3),
            "profit_factor": round(gw / gl, 2) if gl > 0 else 0,
        }

    # By timeframe
    tfg: dict[str, list] = {}
    for t in closed:
        tfg.setdefault(t.timeframe, []).append(t)
    for tf, grp in tfg.items():
        rs = [t.r_multiple for t in grp]
        w  = sum(1 for t in grp if t.outcome == "win")
        m.by_timeframe[tf] = {
            "total":    len(grp),
            "wins":     w,
            "win_rate": round(w / len(grp) * 100, 1),
            "avg_r":    round(sum(rs) / len(rs), 3),
        }

    # By ticker (top 15)
    tkg: dict[str, list] = {}
    for t in closed:
        tkg.setdefault(t.ticker, []).append(t)
    top15 = sorted(tkg.items(), key=lambda x: len(x[1]), reverse=True)[:15]
    for tk, grp in top15:
        rs = [t.r_multiple for t in grp]
        w  = sum(1 for t in grp if t.outcome == "win")
        m.by_ticker[tk] = {
            "total":    len(grp),
            "wins":     w,
            "win_rate": round(w / len(grp) * 100, 1),
            "avg_r":    round(sum(rs) / len(rs), 3),
            "total_r":  round(sum(rs), 3),
        }

    # Monthly
    mo: dict[str, list] = {}
    for t in closed:
        month = t.entry_date[:7] if t.entry_date else "unknown"
        mo.setdefault(month, []).append(t.r_multiple)
    for month, rs in sorted(mo.items()):
        m.monthly_returns.append({
            "month":   month,
            "total_r": round(sum(rs), 3),
            "trades":  len(rs),
            "wins":    sum(1 for r in rs if r > 0),
        })

    return m
