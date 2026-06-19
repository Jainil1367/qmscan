"""
core/scanner.py
Main scanner loop — orchestrates all detectors for all symbols and timeframes.
Includes Master Setup detection: stocks with active setups on 2+ timeframes.
"""
from __future__ import annotations
import asyncio
import logging
from datetime import datetime
from typing import Optional

from core.config import TIMEFRAMES, SETUPS, SCAN_INTERVAL
from core.models import DetectedSetup
from detectors.choch import detect_choch
from detectors.fibonacci import analyze_fib_setup
from detectors.order_block import find_ob_at_price
from detectors.htf_confluence import check_htf_confluence, get_htf_timeframe
from detectors.master_setup import evaluate_master_setup

logger = logging.getLogger("qmscan.scanner")


class Scanner:

    def __init__(
        self,
        data_client,
        alert_engine,
        universe: list[str],
        timeframes: Optional[list[str]] = None,
        trade_store=None,
    ):
        self.data_client = data_client
        self.alert_engine = alert_engine
        self.trade_store = trade_store
        self.universe = universe
        self.timeframes = timeframes or list(TIMEFRAMES.keys())

        # Watchlist: per-timeframe + master
        self.watchlist: dict[str, list] = {tf: [] for tf in self.timeframes}
        self.watchlist["master"] = []

        self._running = False
        self._scan_count = 0
        self._last_scan: Optional[datetime] = None
        self.on_watchlist_update = None

    async def start(self):
        self._running = True
        logger.info(f"Scanner started — {len(self.universe)} symbols, {self.timeframes}")
        while self._running:
            await self.run_full_scan()
            await asyncio.sleep(SCAN_INTERVAL)

    def stop(self):
        self._running = False

    async def run_full_scan(self):
        logger.info(f"Scan #{self._scan_count + 1} starting...")
        new_watchlist: dict[str, list] = {tf: [] for tf in self.timeframes}
        new_watchlist["master"] = []

        # Per-ticker results for master setup evaluation
        ticker_tf_setups: dict[str, dict[str, Optional[DetectedSetup]]] = {
            ticker: {} for ticker in self.universe
        }

        tasks = []
        for timeframe in self.timeframes:
            for ticker in self.universe:
                tasks.append(self._scan_symbol(ticker, timeframe, new_watchlist, ticker_tf_setups))

        from core.config import SCAN_BATCH_SIZE, SCAN_BATCH_DELAY
        for i in range(0, len(tasks), SCAN_BATCH_SIZE):
            await asyncio.gather(*tasks[i:i + SCAN_BATCH_SIZE], return_exceptions=True)
            if i + SCAN_BATCH_SIZE < len(tasks):
                await asyncio.sleep(SCAN_BATCH_DELAY)

        # ── Master Setup pass ─────────────────────────────────────────────
        for ticker, tf_setups in ticker_tf_setups.items():
            master = evaluate_master_setup(ticker, tf_setups)
            if master:
                new_watchlist["master"].append(master)
                logger.info(
                    f"  [MASTER] {ticker} score={master.score} "
                    f"tfs={master.timeframes_str}"
                )
                await self.alert_engine.emit_master(master)

        # Sort master by score descending
        new_watchlist["master"].sort(key=lambda m: m.score, reverse=True)

        self.watchlist = new_watchlist
        self._scan_count += 1
        self._last_scan = datetime.utcnow()

        total = sum(len(v) for v in new_watchlist.values())
        logger.info(f"Scan #{self._scan_count} complete — {total} setups found ({len(new_watchlist['master'])} master)")

        if self.on_watchlist_update:
            await self.on_watchlist_update(self.get_state())

    async def _scan_symbol(
        self,
        ticker: str,
        timeframe: str,
        result_dict: dict,
        ticker_tf_setups: dict,
    ):
        try:
            tf_config = TIMEFRAMES[timeframe]
            candles = await self.data_client.get_bars(ticker, timeframe, limit=tf_config["bars"])
            if not candles or len(candles) < 50:
                return

            choch = detect_choch(candles)
            if choch is None:
                return

            setup = analyze_fib_setup(ticker, timeframe, choch, candles)
            if setup is None:
                return

            if SETUPS[setup.setup_id].requires_ob:
                ob = find_ob_at_price(candles, setup.current_price)
                if ob is None:
                    return
                setup.order_block = ob

            htf_tf = get_htf_timeframe(timeframe)
            if htf_tf != timeframe:
                htf_candles = await self.data_client.get_bars(ticker, htf_tf, limit=100)
                confluent, htf_trend = check_htf_confluence(timeframe, htf_candles)
            else:
                confluent, htf_trend = True, "bullish"

            setup.htf_confluent = confluent
            setup.htf_trend = htf_trend

            # ── Filter: skip setup 1 (Impulsive) ─────────────────────────
            if setup.setup_id == 1:
                return

            # ── Extra chart levels ────────────────────────────────────────
            from detectors.choch import find_swing_points
            from core.models import SwingType
            swings = find_swing_points(candles)
            highs = [s for s in swings if s.swing_type == SwingType.HIGH]
            lows  = [s for s in swings if s.swing_type == SwingType.LOW]
            if len(highs) >= 2:
                setup.hh1 = highs[-2].price
            if htf_tf != timeframe and htf_candles:
                setup.htf_key_level = max(c.high for c in htf_candles)
                setup.htf_lq        = min(c.low  for c in htf_candles)
            setup.stop_hunt_level = setup.choch.swing_low.price * 0.995

            # ── Candlestick pattern detection ─────────────────────────────
            from detectors.candle_patterns import detect_patterns
            setup.candle_patterns = detect_patterns(candles)

            result_dict[timeframe].append(setup)
            ticker_tf_setups[ticker][timeframe] = setup  # feed into master

            if self.trade_store:
                try:
                    await self.trade_store.log_setup_event(setup, event="detected")
                except Exception as e:
                    logger.debug(f"History log error for {ticker}: {e}")

            await self.alert_engine.emit(setup)

            logger.info(
                f"  [OK] {ticker} [{timeframe}] Setup {setup.setup_id} "
                f"({setup.setup_name}) @ {setup.current_price:.2f} "
                f"RR={setup.risk_reward} HTF={'[OK]' if confluent else '[X]'}"
            )

        except Exception as e:
            logger.debug(f"  [X] {ticker} [{timeframe}] error: {e}")

    def get_state(self) -> dict:
        watchlist_data = {}
        for tf, setups in self.watchlist.items():
            if tf == "master":
                watchlist_data["master"] = [m.to_dict() for m in setups]
            else:
                watchlist_data[tf] = [s.to_dict() for s in setups]

        total = sum(len(v) for v in self.watchlist.values())
        return {
            "type": "watchlist_update",
            "scan_count": self._scan_count,
            "last_scan": self._last_scan.isoformat() if self._last_scan else None,
            "scan_interval": SCAN_INTERVAL,
            "total_setups": total,
            "watchlist": watchlist_data,
        }

    def get_setup_by_id(self, setup_id: str) -> Optional[DetectedSetup]:
        for tf, setups in self.watchlist.items():
            for s in setups:
                sid = s.id if hasattr(s, 'id') else s.best_setup.id
                if sid == setup_id:
                    return s if hasattr(s, 'to_dict') else s.best_setup
        return None

