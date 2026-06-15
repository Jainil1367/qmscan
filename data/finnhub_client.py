"""
data/finnhub_client.py
Finnhub.io data client.

Free tier: real-time US stock quotes via WebSocket + candle history via REST.
Docs: https://finnhub.io/docs/api
"""
from __future__ import annotations
import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx

from core.config import FINNHUB_API_KEY, FINNHUB_TIMEFRAME_MAP
from core.models import Candle

logger = logging.getLogger("qmscan.finnhub")

BASE_URL = "https://finnhub.io/api/v1"


class FinnhubClient:
    """Async Finnhub REST client for OHLCV candles."""

    def __init__(self, api_key: str = FINNHUB_API_KEY):
        self.api_key = api_key
        self._client: Optional[httpx.AsyncClient] = None
        # Finnhub free tier: 60 API calls/min
        self._rate_limit_delay = 0.2

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(timeout=15.0)
        return self._client

    async def close(self):
        if self._client and not self._client.is_closed:
            await self._client.aclose()

    async def get_bars(
        self,
        ticker: str,
        timeframe: str,
        limit: int = 200,
    ) -> list[Candle]:
        """
        Fetch OHLCV candles from Finnhub /stock/candle.
        Returns list of Candle objects sorted oldest -> newest.
        """
        if not self.api_key:
            raise ValueError("FINNHUB_API_KEY not set in .env")

        resolution = FINNHUB_TIMEFRAME_MAP.get(timeframe)
        if not resolution:
            raise ValueError(f"Unknown timeframe: {timeframe}")

        now = int(datetime.now(timezone.utc).timestamp())
        from_ts = now - 400 * 24 * 3600

        params = {
            "symbol": ticker,
            "resolution": resolution,
            "from": from_ts,
            "to": now,
            "token": self.api_key,
        }

        await asyncio.sleep(self._rate_limit_delay)
        client = await self._get_client()

        try:
            resp = await client.get(f"{BASE_URL}/stock/candle", params=params)
            resp.raise_for_status()
            data = resp.json()

            if data.get("s") != "ok" or not data.get("t"):
                return []

            timestamps = data["t"]
            opens      = data["o"]
            highs      = data["h"]
            lows       = data["l"]
            closes     = data["c"]
            volumes    = data["v"]

            candles = [
                Candle(
                    timestamp=datetime.utcfromtimestamp(timestamps[i]),
                    open=opens[i],
                    high=highs[i],
                    low=lows[i],
                    close=closes[i],
                    volume=volumes[i],
                    vwap=0.0,
                )
                for i in range(len(timestamps))
            ]
            # Trim to requested limit (most recent bars)
            return candles[-limit:]

        except httpx.HTTPStatusError as e:
            logger.warning(f"Finnhub HTTP error {ticker}/{timeframe}: {e.response.status_code}")
            return []
        except Exception as e:
            logger.debug(f"Finnhub error {ticker}/{timeframe}: {e}")
            return []

    async def get_quote(self, ticker: str) -> Optional[dict]:
        """Get latest real-time quote for a ticker."""
        if not self.api_key:
            return None
        client = await self._get_client()
        try:
            resp = await client.get(
                f"{BASE_URL}/quote",
                params={"symbol": ticker, "token": self.api_key},
            )
            data = resp.json()
            return {
                "last": data.get("c"),       # current price
                "open": data.get("o"),
                "high": data.get("h"),
                "low": data.get("l"),
                "prev_close": data.get("pc"),
                "change_pct": data.get("dp"),
            }
        except Exception:
            return None
