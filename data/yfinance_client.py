"""
data/yfinance_client.py
Yahoo Finance client with browser session, TTL cache, 4H resampling, and retry backoff.
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

CACHE_TTL_SECONDS: dict[str, int] = {
    "1H": 300,
    "4H": 600,
    "1D": 1800,
    "1W": 3600,
}

LOOKBACK_PERIOD: dict[str, str] = {
    "1H":  "60d",
    "4H":  "120d",
    "1D":  "1y",
    "1W":  "2y",
}

MAX_RETRIES = 4
BASE_BACKOFF = 4.0


def _make_session() -> requests.Session:
    s = requests.Session()
    s.headers.update({
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
    return s


class YFinanceClient:

    def __init__(self):
        self._cache: dict[tuple, tuple[float, list[Candle]]] = {}
        self._last_request_at: float = 0.0
        self._min_gap = 0.8
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
        raw = await self._download_with_retry(ticker, period, interval)

        if timeframe == "4H" and raw:
            raw = self._resample_4h(raw)

        if raw:
            self._cache[cache_key] = (time.monotonic(), raw)
            return raw[-limit:]

        if cached:
            return cached[1][-limit:]
        return []

    def _resample_4h(self, candles: list[Candle]) -> list[Candle]:
        if not candles:
            return []
        out: list[Candle] = []
        bucket: list[Candle] = []
        bucket_key = None
        for c in candles:
            h = (c.timestamp.hour // 4) * 4
            key = (c.timestamp.date(), h)
            if bucket_key != key:
                if bucket:
                    out.append(self._merge_candles(bucket))
                bucket = [c]
                bucket_key = key
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
                # Use yf.download() not tkr.history() — tkr.history() calls tkr.info
                # internally on newer yfinance which triggers extra API calls that fail
                df = await asyncio.to_thread(
                    yf.download,
                    ticker,
                    period=period,
                    interval=interval,
                    auto_adjust=True,
                    progress=False,
                    session=self._session,
                    multi_level_index=False,
                )
                if df is None or df.empty:
                    return []

                if isinstance(df.columns, pd.MultiIndex):
                    df.columns = df.columns.get_level_values(0)

                candles: list[Candle] = []
                for ts, row in df.iterrows():
                    try:
                        dt = ts.to_pydatetime()
                        if dt.tzinfo is not None:
                            dt = dt.replace(tzinfo=None)
                        o = float(row.get("Open",  0) or 0)
                        h = float(row.get("High",  0) or 0)
                        l = float(row.get("Low",   0) or 0)
                        c = float(row.get("Close", 0) or 0)
                        v = float(row.get("Volume",0) or 0)
                        if o > 0 and h > 0 and l > 0 and c > 0:
                            candles.append(Candle(timestamp=dt, open=o, high=h, low=l, close=c, volume=v, vwap=0.0))
                    except Exception:
                        continue
                return candles

            except Exception as e:
                err = str(e)
                is_rate = any(x in err for x in ("Rate limit", "Too Many Requests", "429", "rate limited", "YFRateLimitError"))
                if is_rate and attempt < MAX_RETRIES - 1:
                    backoff = BASE_BACKOFF * (2 ** attempt) + random.uniform(1, 3)
                    logger.warning(f"{ticker}: rate limited, waiting {backoff:.0f}s (attempt {attempt+1})")
                    await asyncio.sleep(backoff)
                    self._session = _make_session()
                    continue
                if attempt < MAX_RETRIES - 1:
                    await asyncio.sleep(1.0)
                    continue
                logger.debug(f"yfinance failed {ticker}/{interval}: {e}")
                return []
        return []

    async def _throttle(self):
        now = time.monotonic()
        elapsed = now - self._last_request_at
        if elapsed < self._min_gap:
            await asyncio.sleep(self._min_gap - elapsed + random.uniform(0, 0.2))
        self._last_request_at = time.monotonic()

    async def get_quote(self, ticker: str) -> Optional[dict]:
        try:
            tkr = yf.Ticker(ticker, session=self._session)
            info = await asyncio.to_thread(lambda: tkr.fast_info)
            return {"last": info.last_price, "open": info.open, "prev_close": info.previous_close}
        except Exception:
            return None

    async def close(self):
        try:
            self._session.close()
        except Exception:
            pass