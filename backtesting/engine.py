"""
backtesting/engine.py
Walk-forward backtester for ICT Fibonacci setups.

For each ticker × timeframe:
  1. Download 5 years of OHLCV data
  2. Walk bar-by-bar (no look-ahead)
  3. At each bar, run CHoCH + Fibonacci detection on the last N bars
  4. If a setup fires:
     - Record entry at next bar's open
     - Walk forward until price hits target (win) or stop loss (loss)
     - Skip setup 1 (Impulsive) to match live scanner
  5. Compute all metrics from the trade list
"""
from __future__ import annotations
import asyncio
import logging
from datetime import datetime, timezone
from typing import Callable, Optional

from core.config import SETUPS, CHOCH_LOOKBACK, SWING_STRENGTH
from core.models import Candle
from detectors.choch import detect_choch
from detectors.fibonacci import analyze_fib_setup, calc_fib_level
from detectors.candle_patterns import detect_patterns
from backtesting.metrics import BacktestTrade, BacktestMetrics, compute_metrics

logger = logging.getLogger("qmscan.backtest")

# How many bars to hold maximum before closing at market
MAX_BARS_HELD = 30
# Minimum lookback before we start testing
MIN_BARS_BEFORE_TEST = 60
# Cooldown bars after a trade exits before taking the next trade on same ticker+TF
TRADE_COOLDOWN_BARS = 5




class BacktestEngine:
    """
    Manages a full backtest run across multiple tickers and timeframes.
    Runs asynchronously so it doesn't block the API server.
    """

    def __init__(self, data_client):
        self.data_client = data_client
        self._running   = False
        self._progress  = 0        # 0–100
        self._status    = "idle"   # idle | running | done | error
        self._message   = ""
        self._results: Optional[dict] = None
        self._trades: list[BacktestTrade] = []
        self._task: Optional[asyncio.Task] = None

    # ── Public API ────────────────────────────────────────────────────────
    def get_status(self) -> dict:
        return {
            "status":   self._status,
            "progress": self._progress,
            "message":  self._message,
            "has_results": self._results is not None,
        }

    def get_results(self) -> Optional[dict]:
        return self._results

    def start(
        self,
        tickers: list[str],
        timeframes: list[str],
        years: int = 5,
        progress_cb: Optional[Callable] = None,
    ):
        if self._running:
            return False
        self._results = None
        self._trades  = []
        self._progress = 0
        self._status   = "running"
        self._message  = "Starting backtest..."
        self._task = asyncio.create_task(
            self._run(tickers, timeframes, years, progress_cb)
        )
        return True

    def cancel(self):
        if self._task and not self._task.done():
            self._task.cancel()
        self._running = False
        self._status  = "idle"
        self._message = "Cancelled"

    # ── Core runner ───────────────────────────────────────────────────────
    async def _run(
        self,
        tickers: list[str],
        timeframes: list[str],
        years: int,
        progress_cb: Optional[Callable],
    ):
        self._running = True
        total_work = len(tickers) * len(timeframes)
        done = 0
        all_trades: list[BacktestTrade] = []

        # --- yfinance lookback periods for 5 years -----------------------
        period_map = {
            "1H": "5y",
            "4H": "5y",   # fetched as 1H then resampled
            "1D": "5y",
            "1W": "5y",
        }

        try:
            for ticker in tickers:
                for tf in timeframes:
                    self._message = f"Scanning {ticker} [{tf}]..."

                    try:
                        # Override lookback to 5 years for backtest
                        orig_period = self.data_client.LOOKBACK_PERIOD.copy() if hasattr(self.data_client, 'LOOKBACK_PERIOD') else {}
                        candles = await self._fetch_5y(ticker, tf)
                        if not candles or len(candles) < MIN_BARS_BEFORE_TEST:
                            done += 1
                            continue

                        trades = self._backtest_series(ticker, tf, candles)
                        all_trades.extend(trades)

                    except asyncio.CancelledError:
                        raise
                    except Exception as e:
                        logger.debug(f"BT error {ticker}/{tf}: {e}")

                    done += 1
                    self._progress = int(done / total_work * 90)   # 90% for scanning
                    await asyncio.sleep(0)   # yield to event loop

            # ── Compute metrics ───────────────────────────────────────────
            self._message  = f"Computing metrics for {len(all_trades)} trades..."
            self._progress = 92
            await asyncio.sleep(0)

            metrics: BacktestMetrics = compute_metrics(all_trades)

            # ── Build result payload ──────────────────────────────────────
            self._results = {
                "metrics":    metrics.to_dict(),
                "trades":     [self._trade_to_dict(t) for t in all_trades[-500:]],  # last 500 for UI
                "trade_count": len(all_trades),
                "tickers_scanned": len(tickers),
                "timeframes": timeframes,
                "generated_at": datetime.now(timezone.utc).isoformat(),
            }
            self._trades   = all_trades
            self._progress = 100
            self._status   = "done"
            self._message  = f"Complete — {len(all_trades)} trades across {len(tickers)} tickers"
            logger.info(self._message)

        except asyncio.CancelledError:
            self._status  = "idle"
            self._message = "Cancelled"
        except Exception as e:
            self._status  = "error"
            self._message = f"Error: {e}"
            logger.error(f"Backtest error: {e}", exc_info=True)
        finally:
            self._running = False

    async def _fetch_5y(self, ticker: str, tf: str) -> list[Candle]:
        """Fetch 5 years of data, bypassing the normal TTL cache."""
        import yfinance as yf
        import pandas as pd

        interval = "1h" if tf in ("1H", "4H") else ("1d" if tf == "1D" else "1wk")
        # yfinance max for hourly is 730 days; use max period
        period = "730d" if tf in ("1H", "4H") else "5y"

        df = await asyncio.to_thread(
            yf.download, ticker, period=period, interval=interval,
            progress=False, auto_adjust=True, multi_level_index=False,
        )
        if df is None or df.empty:
            return []

        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.get_level_values(0)

        from core.models import Candle as C
        raw = []
        for ts, row in df.iterrows():
            raw.append(C(
                timestamp=ts.to_pydatetime().replace(tzinfo=None),
                open=float(row["Open"]),
                high=float(row["High"]),
                low=float(row["Low"]),
                close=float(row["Close"]),
                volume=float(row.get("Volume", 0)),
                vwap=0.0,
            ))

        if tf == "4H" and raw:
            raw = self.data_client._resample_4h(raw)

        return raw

    def _backtest_series(
        self, ticker: str, tf: str, candles: list[Candle]
    ) -> list[BacktestTrade]:
        """
        Walk forward bar-by-bar and simulate all setups found.
        No look-ahead: detection uses candles[:i], exit uses candles[i:].
        """
        trades: list[BacktestTrade] = []
        n = len(candles)
        in_trade = False
        active: Optional[BacktestTrade] = None
        cooldown = 0

        for i in range(MIN_BARS_BEFORE_TEST, n):
            # ── Manage open trade ─────────────────────────────────────────
            if in_trade and active:
                bar = candles[i]
                # Check SL / Target hit (use high/low for intra-bar check)
                if bar.low <= active.stop_loss:
                    active.exit_price = active.stop_loss
                    active.exit_bar   = i
                    active.exit_date  = str(bar.timestamp.date())
                    active.bars_held  = i - active.entry_bar
                    active.outcome    = "loss"
                    risk = active.entry_price - active.stop_loss
                    active.r_multiple = round(-1.0, 3)
                    trades.append(active)
                    in_trade  = False
                    active    = None
                    cooldown  = TRADE_COOLDOWN_BARS
                elif bar.high >= active.target:
                    risk = active.entry_price - active.stop_loss
                    reward = active.target - active.entry_price
                    r = round(reward / risk, 3) if risk > 0 else 0
                    active.exit_price = active.target
                    active.exit_bar   = i
                    active.exit_date  = str(bar.timestamp.date())
                    active.bars_held  = i - active.entry_bar
                    active.outcome    = "win"
                    active.r_multiple = r
                    trades.append(active)
                    in_trade  = False
                    active    = None
                    cooldown  = TRADE_COOLDOWN_BARS
                elif i - active.entry_bar >= MAX_BARS_HELD:
                    # Time exit
                    close_p = bar.close
                    risk    = active.entry_price - active.stop_loss
                    pnl_r   = round((close_p - active.entry_price) / risk, 3) if risk > 0 else 0
                    active.exit_price = close_p
                    active.exit_bar   = i
                    active.exit_date  = str(bar.timestamp.date())
                    active.bars_held  = MAX_BARS_HELD
                    active.outcome    = "win" if pnl_r > 0 else "loss"
                    active.r_multiple = pnl_r
                    trades.append(active)
                    in_trade  = False
                    active    = None
                    cooldown  = TRADE_COOLDOWN_BARS
                continue

            if cooldown > 0:
                cooldown -= 1
                continue

            # ── Detection on bars[:i] (no look-ahead) ─────────────────────
            window = candles[max(0, i - 120): i]
            if len(window) < MIN_BARS_BEFORE_TEST:
                continue

            choch = detect_choch(window)
            if not choch:
                continue

            setup = analyze_fib_setup(ticker, tf, choch, window)
            if not setup:
                continue

            # Skip setup 1 (matches live scanner behaviour)
            if setup.setup_id == 1:
                continue

            # ── Entry on NEXT bar open ────────────────────────────────────
            if i + 1 >= n:
                continue

            entry_bar = candles[i + 1]
            entry_price = entry_bar.open

            # Validate entry is still valid (price didn't gap through SL)
            if entry_price <= setup.stop_loss:
                continue

            patterns = detect_patterns(window[-3:])

            trade = BacktestTrade(
                ticker=ticker,
                timeframe=tf,
                setup_id=setup.setup_id,
                setup_name=setup.setup_name,
                entry_bar=i + 1,
                entry_price=entry_price,
                stop_loss=setup.stop_loss,
                target=setup.target,
                fib_entry_pct=setup.fib_entry_pct,
                htf_confluent=setup.htf_confluent,
                order_block=bool(setup.order_block),
                swing_high=choch.swing_high.price,
                swing_low=choch.swing_low.price,
                entry_date=str(entry_bar.timestamp.date()),
                candle_patterns=[p["name"] for p in patterns],
                outcome="open",
            )
            in_trade = True
            active   = trade

        # If still in a trade at end of data, close at last close
        if in_trade and active and candles:
            last = candles[-1]
            risk = active.entry_price - active.stop_loss
            pnl_r = round((last.close - active.entry_price) / risk, 3) if risk > 0 else 0
            active.exit_price = last.close
            active.exit_bar   = n - 1
            active.exit_date  = str(last.timestamp.date())
            active.bars_held  = n - 1 - active.entry_bar
            active.outcome    = "win" if pnl_r > 0 else "loss"
            active.r_multiple = pnl_r
            trades.append(active)

        return trades

    @staticmethod
    def _trade_to_dict(t: BacktestTrade) -> dict:
        return {
            "ticker":         t.ticker,
            "timeframe":      t.timeframe,
            "setup_id":       t.setup_id,
            "setup_name":     t.setup_name,
            "entry_price":    round(t.entry_price, 4),
            "stop_loss":      round(t.stop_loss, 4),
            "target":         round(t.target, 4),
            "exit_price":     round(t.exit_price, 4),
            "fib_entry_pct":  t.fib_entry_pct,
            "htf_confluent":  t.htf_confluent,
            "order_block":    t.order_block,
            "swing_high":     round(t.swing_high, 4),
            "swing_low":      round(t.swing_low, 4),
            "outcome":        t.outcome,
            "r_multiple":     t.r_multiple,
            "bars_held":      t.bars_held,
            "entry_date":     t.entry_date,
            "exit_date":      t.exit_date,
            "candle_patterns":t.candle_patterns,
        }