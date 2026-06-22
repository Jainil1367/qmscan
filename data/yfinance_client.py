"""
data/yfinance_client.py
Yahoo Finance data client via yfinance.

Fixes for cloud-IP rate limiting:
  - Persistent requests.Session with browser User-Agent header
  - Per-request throttle with minimum 0.8s gap (up from 0.35s)
  - Exponential backoff: 4s, 8s, 16s on rate-limit errors
  - In-memory TTL cache so repeated scans reuse recent data
  - 4H resampled from 1H bars (yfinance has no native 4H)
"""
from __future__ import annotations
import asyncio
import logging
import random
import time
from typing import Optional

import pandas as pd
import requests
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

# Lookback periods — keep generous so we have enough bars for detection
LOOKBACK_PERIOD: dict[str, str] = {
    "1H": "60d",
    "4H": "120d",
    "1D": "1y",
    "1W": "2y",
}

MAX_RETRIES = 4
BASE_BACKOFF = 4.0   # doubled from 2.0


def _make_session() -> requests.Session:
    """
    Create a requests session that looks like a real browser.
    This is the single most effective fix for Yahoo Finance rate limiting
    on shared cloud IPs — Yahoo's rate limiter is User-Agent aware.
    """
    session = requests.Session()
    session.headers.update({
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/125.0.0.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Accept-Encoding": "gzip, deflate, br",
        "Connection": "keep-alive",
    })
    return session


class YFinanceClient:

    def __init__(self):
        self._cache: dict[tuple[str, str], tuple[float, list[Candle]]] = {}
        self._last_request_at: float = 0.0
        self._min_request_gap = 0.8   # seconds — increased from 0.35
        self._session = _make_session()

    async def get_bars(self, ticker: str, timeframe: str, limit: int = 200) -> list[Candle]:
        fetch_tf = "1H" if timeframe == "4H" else timeframe
        interval = YFINANCE_TIMEFRAME_MAP.get(fetch_tf)
        if not interval:
            raise ValueError(f"Unknown timeframe: {timeframe}")

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

        if raw_candles:
            self._cache[cache_key] = (time.monotonic(), raw_candles)
            return raw_candles[-limit:]

        if cached:
            logger.debug(f"{ticker}/{timeframe}: using stale cache after failed refresh")
            return cached[1][-limit:]

        return []

    def _resample_4h(self, candles: list[Candle]) -> list[Candle]:
        if not candles:
            return []
        out = []
        bucket: list[Candle] = []
        bucket_key = None

        for c in candles:
            h = (c.timestamp.hour // 4) * 4
            day_key = (c.timestamp.date(), h)
            if bucket_key != day_key:
                if bucket:
                    out.append(self._merge_candles(bucket))
                bucket = [c]
                bucket_key = day_key
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
                # Pass the browser-like session to yfinance
                tkr = yf.Ticker(ticker, session=self._session)
                df = await asyncio.to_thread(
                    tkr.history,
                    period=period,
                    interval=interval,
                    auto_adjust=True,
                    prepost=False,
                )

                if df is None or df.empty:
                    return []

                # Flatten MultiIndex if present
                if isinstance(df.columns, pd.MultiIndex):
                    df.columns = df.columns.get_level_values(0)

                candles = []
                for ts, row in df.iterrows():
                    try:
                        # Handle both tz-aware and tz-naive timestamps
                        dt = ts.to_pydatetime()
                        if dt.tzinfo is not None:
                            dt = dt.replace(tzinfo=None)
                        candles.append(Candle(
                            timestamp=dt,
                            open=float(row["Open"]),
                            high=float(row["High"]),
                            low=float(row["Low"]),
                            close=float(row["Close"]),
                            volume=float(row.get("Volume", 0) or 0),
                            vwap=0.0,
                        ))
                    except Exception:
                        continue

                return candles

            except Exception as e:
                err = str(e)
                is_rate_limit = any(x in err for x in (
                    "Rate limit", "Too Many Requests", "YFRateLimitError",
                    "429", "rate limited",
                ))

                if is_rate_limit and attempt < MAX_RETRIES - 1:
                    # Exponential backoff with jitter
                    backoff = BASE_BACKOFF * (2 ** attempt) + random.uniform(1, 3)
                    logger.warning(
                        f"{ticker}: rate limited (attempt {attempt + 1}/{MAX_RETRIES}), "
                        f"waiting {backoff:.0f}s before retry"
                    )
                    await asyncio.sleep(backoff)
                    # Refresh session on rate limit — new session = new connection
                    self._session = _make_session()
                    continue

                if attempt < MAX_RETRIES - 1:
                    await asyncio.sleep(1.0)
                    continue

                logger.debug(f"yfinance failed {ticker}/{interval} after {MAX_RETRIES} attempts: {e}")
                return []

        return []

    async def _throttle(self):
        """Enforce minimum gap between outbound requests."""
        now = time.monotonic()
        elapsed = now - self._last_request_at
        if elapsed < self._min_request_gap:
            await asyncio.sleep(self._min_request_gap - elapsed + random.uniform(0, 0.2))
        self._last_request_at = time.monotonic()

    async def get_quote(self, ticker: str) -> Optional[dict]:
        try:
            tkr = yf.Ticker(ticker, session=self._session)
            info = await asyncio.to_thread(lambda: tkr.fast_info)
            return {
                "last":       info.last_price,
                "open":       info.open,
                "high":       info.day_high,
                "low":        info.day_low,
                "prev_close": info.previous_close,
            }
        except Exception:
            return None

    async def close(self):
        try:
            self._session.close()
        except Exception:
            pass