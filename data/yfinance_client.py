"""
data/yfinance_client.py
Yahoo Finance data client via yfinance.

Free, no API key required. Supports 1m/5m/15m/30m/1h/1d/1wk/1mo.

Includes:
  - In-memory TTL cache per (ticker, timeframe) to avoid re-downloading
    the same data every scan cycle.
  - Retry with exponential backoff + jitter on rate-limit errors.
  - Reduced lookback periods (we only ever use the last ~200 bars anyway).
  - A small inter-request delay to spread out load on shared cloud IPs.
"""
from __future__ import annotations
import asyncio
import logging
import random
import time
from typing import Optional

import pandas as pd
import yfinance as yf

from core.config import YFINANCE_TIMEFRAME_MAP
from core.models import Candle

logger = logging.getLogger("qmscan.yfinance")


# Cache TTL per timeframe
CACHE_TTL_SECONDS: dict[str, int] = {
    "1H": 300,
    "4H": 600,
    "1D": 1800,
    "1W": 3600,
}

# Shorter lookback periods — we only keep the last `limit` bars anyway
LOOKBACK_PERIOD: dict[str, str] = {
    "1H": "60d",
    "4H": "120d",   # needs more 1H bars to produce enough 4H bars after resampling
    "1D": "1y",
    "1W": "2y",
}

MAX_RETRIES = 3
BASE_BACKOFF = 2.0  # seconds


class YFinanceClient:

    def __init__(self):
        # cache[(ticker, timeframe)] = (timestamp, candles)
        self._cache: dict[tuple[str, str], tuple[float, list[Candle]]] = {}
        self._last_request_at: float = 0.0
        self._min_request_gap = 0.35  # seconds between outbound requests

    async def get_bars(self, ticker: str, timeframe: str, limit: int = 200) -> list[Candle]:
        # 4H is resampled from 1H data
        fetch_tf = "1H" if timeframe == "4H" else timeframe

        interval = YFINANCE_TIMEFRAME_MAP.get(fetch_tf)
        if not interval:
            raise ValueError(f"Unknown timeframe: {timeframe}")

        # ── Serve from cache if fresh ──────────────────────────────────────
        cache_key = (ticker, timeframe)
        ttl = CACHE_TTL_SECONDS.get(timeframe, 300)
        cached = self._cache.get(cache_key)
        if cached:
            cached_at, candles = cached
            if time.monotonic() - cached_at < ttl:
                return candles[-limit:]

        period = LOOKBACK_PERIOD.get(timeframe, "60d")
        raw_candles = await self._download_with_retry(ticker, period, interval)

        if timeframe == "4H" and raw_candles:
            raw_candles = self._resample_4h(raw_candles)

        candles = raw_candles
        if candles:
            self._cache[cache_key] = (time.monotonic(), candles)
            return candles[-limit:]

        if cached:
            logger.debug(f"{ticker}/{timeframe}: using stale cache after failed refresh")
            return cached[1][-limit:]

        return []

    def _resample_4h(self, candles: list[Candle]) -> list[Candle]:
        """Resample 1H candles into 4H candles."""
        if not candles:
            return []
        out = []
        bucket: list[Candle] = []
        bucket_start_hour = -1

        for c in candles:
            # Group by 4-hour windows: 0,4,8,12,16,20
            h = (c.timestamp.hour // 4) * 4
            day_key = (c.timestamp.date(), h)
            if bucket_start_hour != day_key:
                if bucket:
                    out.append(self._merge_candles(bucket))
                bucket = [c]
                bucket_start_hour = day_key
            else:
                bucket.append(c)
        if bucket:
            out.append(self._merge_candles(bucket))
        return out

    def _merge_candles(self, candles: list[Candle]) -> Candle:
        return Candle(
            timestamp=candles[0].timestamp,
            open=candles[0].open,
            high=max(c.high for c in candles),
            low=min(c.low for c in candles),
            close=candles[-1].close,
            volume=sum(c.volume for c in candles),
            vwap=0.0,
        )

    async def _download_with_retry(self, ticker: str, period: str, interval: str) -> list[Candle]:
        for attempt in range(MAX_RETRIES):
            await self._throttle()
            try:
                df = await asyncio.to_thread(
                    yf.download,
                    ticker,
                    period=period,
                    interval=interval,
                    progress=False,
                    auto_adjust=True,
                    multi_level_index=False,
                )
                if df is None or df.empty:
                    return []

                if isinstance(df.columns, pd.MultiIndex):
                    df.columns = df.columns.get_level_values(0)

                candles = []
                for ts, row in df.iterrows():
                    candles.append(Candle(
                        timestamp=ts.to_pydatetime().replace(tzinfo=None),
                        open=float(row["Open"]),
                        high=float(row["High"]),
                        low=float(row["Low"]),
                        close=float(row["Close"]),
                        volume=float(row["Volume"]),
                        vwap=0.0,
                    ))
                return candles

            except Exception as e:
                err_str = str(e)
                is_rate_limit = "Rate limit" in err_str or "Too Many Requests" in err_str or "YFRateLimitError" in err_str

                if is_rate_limit and attempt < MAX_RETRIES - 1:
                    backoff = BASE_BACKOFF * (2 ** attempt) + random.uniform(0, 1)
                    logger.debug(
                        f"{ticker}: rate limited (attempt {attempt + 1}/{MAX_RETRIES}), "
                        f"backing off {backoff:.1f}s"
                    )
                    await asyncio.sleep(backoff)
                    continue

                logger.debug(f"yfinance error {ticker}/{interval}: {e}")
                return []

        return []

    async def _throttle(self):
        """Ensure a minimum gap between outbound requests to reduce
        the chance of tripping Yahoo's rate limiter on shared IPs."""
        now = time.monotonic()
        elapsed = now - self._last_request_at
        if elapsed < self._min_request_gap:
            await asyncio.sleep(self._min_request_gap - elapsed)
        self._last_request_at = time.monotonic()

    async def get_quote(self, ticker: str) -> Optional[dict]:
        try:
            t = yf.Ticker(ticker)
            info = t.fast_info
            return {
                "last": info.last_price,
                "open": info.open,
                "high": info.day_high,
                "low": info.day_low,
                "prev_close": info.previous_close,
            }
        except Exception:
            return None

    async def close(self):
        pass

