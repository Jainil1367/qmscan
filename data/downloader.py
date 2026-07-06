"""
data/downloader.py — Background OHLCV downloader.

Downloads 5 years of 1D and 1W data (plus 730d of 1H/4H) for all NASDAQ-100
tickers and stores them in SQLite. Runs once on startup if data is missing,
then refreshes stale entries in the background.

Usage:
    from data.downloader import DataDownloader
    dl = DataDownloader(data_client)
    await dl.download_all(tickers, timeframes)   # initial download
    await dl.refresh_stale(tickers, timeframes)  # background refresh
"""
from __future__ import annotations
import asyncio
import logging
import time
from typing import Callable, Optional

import yfinance as yf
import pandas as pd

from core.models import Candle
from data.store import (
    init_db, store_candles, load_candles, is_fresh, get_download_status, db_size_mb,
    DB_PATH,
)

logger = logging.getLogger("qmscan.downloader")

# Seconds between downloads to avoid rate limiting
DOWNLOAD_DELAY = 1.0

# Periods per timeframe
PERIODS = {
    "1H":  "730d",
    "4H":  "730d",   # fetched as 1H then resampled
    "1D":  "5y",
    "1W":  "5y",
}

# yfinance intervals
INTERVALS = {
    "1H":  "1h",
    "4H":  "1h",
    "1D":  "1d",
    "1W":  "1wk",
}


class DataDownloader:

    def __init__(self, data_client, db_path: str = DB_PATH):
        self.data_client = data_client
        self.db_path     = db_path
        self._progress   = 0
        self._message    = "idle"
        self._running    = False

        init_db(db_path)

    # ── Status ────────────────────────────────────────────────────────────────
    def get_status(self) -> dict:
        return {
            "running":    self._running,
            "progress":   self._progress,
            "message":    self._message,
            "db_size_mb": round(db_size_mb(self.db_path), 2),
            "store":      get_download_status(self.db_path),
        }

    # ── Main download ─────────────────────────────────────────────────────────
    async def download_all(
        self,
        tickers: list[str],
        timeframes: list[str],
        force: bool = False,
        progress_cb: Optional[Callable] = None,
    ) -> dict:
        """
        Download all tickers × timeframes into SQLite.
        Skips already-fresh entries unless force=True.
        Returns summary dict.
        """
        self._running  = True
        self._progress = 0
        total    = len(tickers) * len(timeframes)
        done     = 0
        skipped  = 0
        downloaded = 0
        failed   = 0

        try:
            for ticker in tickers:
                for tf in timeframes:
                    # Skip if already fresh
                    if not force and is_fresh(ticker, tf, self.db_path):
                        skipped += 1
                        done += 1
                        self._progress = int(done / total * 100)
                        continue

                    self._message = f"Downloading {ticker} [{tf}]..."
                    candles = await self._download_one(ticker, tf)

                    if candles:
                        n = store_candles(ticker, tf, candles,
                                          period=PERIODS.get(tf, "5y"),
                                          path=self.db_path)
                        downloaded += 1
                        logger.info(f"  {ticker}/{tf}: stored {n} bars")
                    else:
                        failed += 1
                        logger.warning(f"  {ticker}/{tf}: no data")

                    done += 1
                    self._progress = int(done / total * 100)

                    if progress_cb:
                        progress_cb(self._progress, self._message)

                    # Rate limit delay
                    await asyncio.sleep(DOWNLOAD_DELAY)

            self._message = (
                f"Download complete: {downloaded} downloaded, "
                f"{skipped} skipped (fresh), {failed} failed. "
                f"DB size: {db_size_mb(self.db_path):.1f} MB"
            )
            logger.info(self._message)

        except Exception as e:
            logger.error(f"Download error: {e}", exc_info=True)
            self._message = f"Download error: {e}"
        finally:
            self._running  = False
            self._progress = 100

        return {
            "downloaded": downloaded,
            "skipped":    skipped,
            "failed":     failed,
            "db_size_mb": round(db_size_mb(self.db_path), 2),
        }

    async def refresh_stale(self, tickers: list[str], timeframes: list[str]) -> None:
        """Refresh only stale entries — safe to call in background."""
        stale = [
            (t, tf) for t in tickers for tf in timeframes
            if not is_fresh(t, tf, self.db_path)
        ]
        if not stale:
            return

        logger.info(f"Refreshing {len(stale)} stale entries...")
        for ticker, tf in stale:
            candles = await self._download_one(ticker, tf)
            if candles:
                store_candles(ticker, tf, candles, period=PERIODS.get(tf, "5y"), path=self.db_path)
                logger.info(f"  Refreshed {ticker}/{tf}: {len(candles)} bars")
            await asyncio.sleep(DOWNLOAD_DELAY)

    # ── Single ticker/TF download ─────────────────────────────────────────────
    async def _download_one(self, ticker: str, tf: str) -> list[Candle]:
        interval = INTERVALS.get(tf, "1d")
        period   = PERIODS.get(tf, "5y")

        # Try multiple strategies — yfinance API changed significantly in v1.4+
        raw = await self._try_download(ticker, interval, period)

        # Resample 1H → 4H
        if tf == "4H" and raw:
            raw = self.data_client._resample_4h(raw)

        return raw

    async def _try_download(self, ticker: str, interval: str, period: str) -> list[Candle]:
        """
        Try yf.download() with our session. Falls back to Ticker.history()
        if the first attempt fails. Handles yfinance crumb/cookie issues.
        """
        import pandas as pd
        session = getattr(self.data_client, '_session', None)

        # Strategy 1: yf.download() — fastest, no crumb needed for most tickers
        try:
            df = await asyncio.to_thread(
                yf.download, ticker,
                period=period, interval=interval,
                auto_adjust=True, progress=False,
                session=session, multi_level_index=False,
                repair=False,
            )
            if df is not None and not df.empty:
                return self._df_to_candles(df)
        except Exception as e:
            logger.debug(f"  {ticker} yf.download failed: {e}, trying Ticker.history")

        # Strategy 2: Ticker.history() — handles crumb internally
        try:
            tkr = yf.Ticker(ticker, session=session) if session else yf.Ticker(ticker)
            df = await asyncio.to_thread(
                tkr.history, period=period, interval=interval,
                auto_adjust=True, prepost=False,
                raise_errors=False,
            )
            if df is not None and not df.empty:
                return self._df_to_candles(df)
        except Exception as e:
            logger.debug(f"  {ticker} Ticker.history failed: {e}")

        # Rate limit check
        return []

    def _df_to_candles(self, df) -> list[Candle]:
        """Convert a yfinance DataFrame to a list of Candle objects."""
        import pandas as pd
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.get_level_values(0)

        raw: list[Candle] = []
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
                    raw.append(Candle(timestamp=dt, open=o, high=h,
                                      low=l, close=c, volume=v, vwap=0.0))
            except Exception:
                continue
        return raw

    def get_stored(self, ticker: str, tf: str) -> list[Candle]:
        """Synchronous read from SQLite — instant."""
        return load_candles(ticker, tf, path=self.db_path)