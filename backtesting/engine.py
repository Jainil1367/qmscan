"""
backtesting/engine.py  — Full walk-forward backtester (fast parallel version)

Speed improvements vs naive sequential:
  - Concurrent ticker scanning: 5 tickers in parallel (asyncio.gather)
  - Partial results shown immediately as each ticker finishes
  - 1D/1W downloaded directly (no yfinance rate limits on daily data)
  - 1H/4H reuse live scanner cache when possible, download otherwise
  - Full detection pipeline kept intact: detect_choch → analyze_fib_setup
    → candlestick patterns, exactly as the live scanner does it
  - SLIDE_STEP=1 (every bar) for 1D/1W, SLIDE_STEP=3 for 1H/4H (still accurate,
    at most misses entry by 3 bars which is acceptable for historical validation)
"""
from __future__ import annotations
import asyncio
import logging
import time
from datetime import datetime, timezone
from dataclasses import dataclass, field
from typing import Optional, Callable

from core.models import Candle
from detectors.choch import detect_choch
from detectors.fibonacci import analyze_fib_setup
from detectors.candle_patterns import detect_patterns
from backtesting.metrics import BacktestTrade, compute_metrics

logger = logging.getLogger("qmscan.backtest")

# ── Tuning ────────────────────────────────────────────────────────────────────
MAX_BARS_HELD       = 30    # time-exit after this many bars
MIN_BARS_WINDOW     = 60    # minimum candles before we start detecting
WINDOW_SIZE         = 120   # detection window fed to detect_choch
TRADE_COOLDOWN      = 5     # bars to wait after a trade closes
SLIDE_STEP_DAILY    = 1     # check every bar on 1D/1W (fast data)
SLIDE_STEP_INTRADAY = 3     # check every 3 bars on 1H/4H (still very accurate)
CONCURRENT_TICKERS  = 5     # how many tickers to scan in parallel
PARTIAL_FLUSH_EVERY = 5     # recompute metrics and update results every N tickers
MAX_RUNTIME_SEC     = 480   # hard cap: 8 minutes, then return partial results


class BacktestEngine:

    def __init__(self, data_client):
        self.data_client = data_client
        self._running    = False
        self._progress   = 0
        self._status     = "idle"
        self._message    = ""
        self._results    = None
        self._task       = None

    # ── Public API ────────────────────────────────────────────────────────────
    def get_status(self) -> dict:
        return {
            "status":      self._status,
            "progress":    self._progress,
            "message":     self._message,
            "has_results": self._results is not None,
        }

    def get_results(self):
        return self._results

    def start(self, tickers: list[str], timeframes: list[str],
              years: int = 5, progress_cb: Optional[Callable] = None) -> bool:
        if self._running:
            return False
        self._results  = None
        self._progress = 0
        self._status   = "running"
        self._message  = "Starting backtest..."
        self._task = asyncio.create_task(self._run(tickers, timeframes, years))
        return True

    def cancel(self):
        if self._task and not self._task.done():
            self._task.cancel()
        self._running = False
        self._status  = "idle"
        self._message = "Cancelled"

    # ── Core runner ───────────────────────────────────────────────────────────
    async def _run(self, tickers: list[str], timeframes: list[str], years: int):
        self._running = True
        start_time    = time.monotonic()
        all_trades: list[BacktestTrade] = []
        tickers_done  = 0
        total_tickers = len(tickers)

        try:
            # Process tickers in batches of CONCURRENT_TICKERS
            for batch_start in range(0, total_tickers, CONCURRENT_TICKERS):
                elapsed = time.monotonic() - start_time
                if elapsed > MAX_RUNTIME_SEC:
                    self._message = (
                        f"Time limit reached ({elapsed:.0f}s) — "
                        f"partial results from {tickers_done}/{total_tickers} tickers"
                    )
                    break

                batch = tickers[batch_start: batch_start + CONCURRENT_TICKERS]

                # Scan all timeframes for each ticker in the batch concurrently
                tasks = [
                    self._scan_ticker(ticker, timeframes)
                    for ticker in batch
                ]
                batch_results = await asyncio.gather(*tasks, return_exceptions=True)

                for result in batch_results:
                    if isinstance(result, list):
                        all_trades.extend(result)
                    elif isinstance(result, Exception):
                        logger.debug(f"Batch ticker error: {result}")

                tickers_done += len(batch)
                pct = int(tickers_done / total_tickers * 90)
                self._progress = pct
                self._message  = (
                    f"Scanned {tickers_done}/{total_tickers} tickers — "
                    f"{len(all_trades)} trades found"
                )

                # ── Partial results flush ──────────────────────────────────
                # Show results in the UI while scanning is still running
                if tickers_done % PARTIAL_FLUSH_EVERY == 0 and all_trades:
                    await self._flush_results(all_trades, timeframes, start_time,
                                              tickers_done, partial=True)

                await asyncio.sleep(0)   # yield to event loop between batches

            # ── Final metrics ──────────────────────────────────────────────
            self._message  = f"Computing final metrics for {len(all_trades)} trades..."
            self._progress = 96
            await asyncio.sleep(0)

            await self._flush_results(all_trades, timeframes, start_time,
                                      tickers_done, partial=False)

            elapsed = time.monotonic() - start_time
            self._progress = 100
            self._status   = "done"
            self._message  = (
                f"Complete in {elapsed:.0f}s — {len(all_trades)} trades "
                f"across {tickers_done} tickers"
            )
            logger.info(self._message)

        except asyncio.CancelledError:
            if all_trades:
                await self._flush_results(all_trades, timeframes, start_time,
                                          tickers_done, partial=True)
                self._status  = "done"
                self._message = f"Cancelled — partial results: {len(all_trades)} trades"
            else:
                self._status  = "idle"
                self._message = "Cancelled"

        except Exception as e:
            logger.error(f"Backtest runner error: {e}", exc_info=True)
            if all_trades:
                await self._flush_results(all_trades, timeframes, start_time,
                                          tickers_done, partial=True)
                self._status  = "done"
                self._message = f"Error (partial results saved): {e}"
            else:
                self._status  = "error"
                self._message = f"Error: {e}"
        finally:
            self._running = False

    # ── Scan one ticker across all timeframes ─────────────────────────────────
    async def _scan_ticker(self, ticker: str, timeframes: list[str]) -> list[BacktestTrade]:
        trades = []
        for tf in timeframes:
            try:
                candles = await self._fetch(ticker, tf)
                if not candles or len(candles) < MIN_BARS_WINDOW:
                    continue
                tf_trades = self._walk_forward(ticker, tf, candles)
                trades.extend(tf_trades)
                logger.debug(f"  {ticker}/{tf}: {len(candles)} bars → {len(tf_trades)} trades")
            except Exception as e:
                logger.debug(f"  {ticker}/{tf} error: {e}")
        return trades

    # ── Data fetching ─────────────────────────────────────────────────────────
    async def _fetch(self, ticker: str, tf: str) -> list[Candle]:
        """
        Fetch candles. Prioritises:
        1. Live scanner in-memory cache (instant, no network)
        2. yfinance direct download (1D/1W only — no rate limits)
        3. Live client with throttling (1H/4H)
        """
        # 1. Try cache first — get as many bars as stored
        try:
            cached = await self.data_client.get_bars(ticker, tf, limit=5000)
            if cached and len(cached) >= MIN_BARS_WINDOW:
                return cached
        except Exception:
            pass

        # 2. Direct download for daily/weekly (no rate limit issues)
        if tf in ("1D", "1W"):
            return await self._download_daily(ticker, tf)

        # 3. For 1H/4H — use the live client which handles throttling
        try:
            return await self.data_client.get_bars(ticker, tf, limit=2000)
        except Exception as e:
            logger.debug(f"  {ticker}/{tf} client fetch error: {e}")
            return []

    async def _download_daily(self, ticker: str, tf: str) -> list[Candle]:
        """Download 1D or 1W data directly. No rate limit on Yahoo daily data."""
        try:
            import yfinance as yf
            import pandas as pd

            interval = "1d" if tf == "1D" else "1wk"
            session  = getattr(self.data_client, '_session', None)
            tkr      = yf.Ticker(ticker, session=session) if session else yf.Ticker(ticker)

            df = await asyncio.to_thread(
                tkr.history, period="5y", interval=interval, auto_adjust=True
            )
            if df is None or df.empty:
                return []

            if isinstance(df.columns, pd.MultiIndex):
                df.columns = df.columns.get_level_values(0)

            raw = []
            for ts, row in df.iterrows():
                try:
                    dt = ts.to_pydatetime()
                    if dt.tzinfo:
                        dt = dt.replace(tzinfo=None)
                    o = float(row.get("Open",  0) or 0)
                    h = float(row.get("High",  0) or 0)
                    l = float(row.get("Low",   0) or 0)
                    c = float(row.get("Close", 0) or 0)
                    v = float(row.get("Volume",0) or 0)
                    if o > 0 and h > 0 and l > 0 and c > 0:
                        raw.append(Candle(
                            timestamp=dt, open=o, high=h, low=l,
                            close=c, volume=v, vwap=0.0,
                        ))
                except Exception:
                    continue
            return raw
        except Exception as e:
            logger.debug(f"  _download_daily {ticker}/{tf}: {e}")
            return []

    # ── Full walk-forward — no look-ahead ─────────────────────────────────────
    def _walk_forward(self, ticker: str, tf: str,
                      candles: list[Candle]) -> list[BacktestTrade]:
        """
        Walk bar-by-bar. Detection uses only candles[:i] (no look-ahead).
        Entry taken at next bar open. Exit at SL, TP, or MAX_BARS_HELD.
        Full detect_choch + analyze_fib_setup + candlestick patterns on every step.
        """
        trades   : list[BacktestTrade] = []
        n        = len(candles)
        in_trade = False
        active   : Optional[BacktestTrade] = None
        cooldown = 0
        step     = SLIDE_STEP_INTRADAY if tf in ("1H", "4H") else SLIDE_STEP_DAILY

        i = MIN_BARS_WINDOW
        while i < n:

            # ── Manage open trade ─────────────────────────────────────────
            if in_trade and active:
                bar     = candles[i]
                sl_hit  = bar.low  <= active.stop_loss
                tp_hit  = bar.high >= active.target
                timeout = (i - active.entry_bar) >= MAX_BARS_HELD

                if sl_hit or tp_hit or timeout:
                    risk = active.entry_price - active.stop_loss

                    if tp_hit and not sl_hit:
                        reward = active.target - active.entry_price
                        r = round(reward / risk, 3) if risk > 0 else 0
                        active.exit_price  = active.target
                        active.outcome     = "win"
                        active.r_multiple  = r
                    elif sl_hit:
                        active.exit_price  = active.stop_loss
                        active.outcome     = "loss"
                        active.r_multiple  = -1.0
                    else:
                        # time exit
                        pnl_r = round((bar.close - active.entry_price) / risk, 3) if risk > 0 else 0
                        active.exit_price  = bar.close
                        active.outcome     = "win" if pnl_r > 0 else "loss"
                        active.r_multiple  = pnl_r

                    active.exit_bar  = i
                    active.exit_date = str(bar.timestamp.date())
                    active.bars_held = i - active.entry_bar
                    trades.append(active)
                    in_trade = False
                    active   = None
                    cooldown = TRADE_COOLDOWN

                i += 1
                continue

            if cooldown > 0:
                cooldown -= 1
                i += 1
                continue

            # ── Detection on window candles[i-WINDOW_SIZE : i] ────────────
            window = candles[max(0, i - WINDOW_SIZE): i]

            try:
                choch = detect_choch(window)
                if not choch:
                    i += step
                    continue

                setup = analyze_fib_setup(ticker, tf, choch, window)
                if not setup or setup.setup_id == 1:
                    i += step
                    continue

                # Entry at NEXT bar open — no look-ahead
                if i + 1 >= n:
                    break

                entry_bar   = candles[i + 1]
                entry_price = entry_bar.open

                # Sanity checks
                if (entry_price <= 0 or
                    setup.stop_loss <= 0 or
                    setup.target <= entry_price or
                    entry_price <= setup.stop_loss):
                    i += step
                    continue

                patterns = detect_patterns(window[-3:])

                active = BacktestTrade(
                    ticker          = ticker,
                    timeframe       = tf,
                    setup_id        = setup.setup_id,
                    setup_name      = setup.setup_name,
                    entry_bar       = i + 1,
                    entry_price     = entry_price,
                    stop_loss       = setup.stop_loss,
                    target          = setup.target,
                    fib_entry_pct   = setup.fib_entry_pct,
                    htf_confluent   = setup.htf_confluent,
                    order_block     = bool(setup.order_block),
                    swing_high      = choch.swing_high.price,
                    swing_low       = choch.swing_low.price,
                    entry_date      = str(entry_bar.timestamp.date()),
                    candle_patterns = [p["name"] for p in patterns],
                    outcome         = "open",
                )
                in_trade = True
                i += 1   # move to entry bar on next iteration

            except Exception as e:
                logger.debug(f"Detection error at {ticker}/{tf} bar {i}: {e}")
                i += step
                continue

        # Close any still-open trade at end of data
        if in_trade and active and candles:
            last  = candles[-1]
            risk  = active.entry_price - active.stop_loss
            pnl_r = round((last.close - active.entry_price) / risk, 3) if risk > 0 else 0
            active.exit_price  = last.close
            active.exit_bar    = n - 1
            active.exit_date   = str(last.timestamp.date())
            active.bars_held   = n - 1 - active.entry_bar
            active.outcome     = "win" if pnl_r > 0 else "loss"
            active.r_multiple  = pnl_r
            trades.append(active)

        return trades

    # ── Build and store results ───────────────────────────────────────────────
    async def _flush_results(self, trades: list[BacktestTrade], timeframes: list[str],
                              start_time: float, tickers_done: int, partial: bool):
        try:
            metrics = compute_metrics(trades)
            elapsed = time.monotonic() - start_time
            self._results = {
                "metrics":         metrics.to_dict(),
                "trades":          [_trade_dict(t) for t in trades[-500:]],
                "trade_count":     len(trades),
                "tickers_scanned": len(set(t.ticker for t in trades)),
                "timeframes":      timeframes,
                "elapsed_sec":     round(elapsed, 1),
                "partial":         partial,
                "generated_at":    datetime.now(timezone.utc).isoformat(),
            }
            if partial:
                self._status = "running"   # keep status as running for partial flush
        except Exception as e:
            logger.error(f"_flush_results error: {e}")


# ── Serialise a trade ─────────────────────────────────────────────────────────
def _trade_dict(t: BacktestTrade) -> dict:
    return {
        "ticker":          t.ticker,
        "timeframe":       t.timeframe,
        "setup_id":        t.setup_id,
        "setup_name":      t.setup_name,
        "entry_price":     round(t.entry_price,  4),
        "stop_loss":       round(t.stop_loss,    4),
        "target":          round(t.target,       4),
        "exit_price":      round(t.exit_price,   4),
        "fib_entry_pct":   t.fib_entry_pct,
        "htf_confluent":   t.htf_confluent,
        "order_block":     t.order_block,
        "swing_high":      round(t.swing_high,   4),
        "swing_low":       round(t.swing_low,    4),
        "outcome":         t.outcome,
        "r_multiple":      t.r_multiple,
        "bars_held":       t.bars_held,
        "entry_date":      t.entry_date,
        "exit_date":       t.exit_date,
        "candle_patterns": t.candle_patterns,
    }