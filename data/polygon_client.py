"""
data/polygon_client.py
Polygon.io data client.

Provides async get_bars() compatible with the scanner interface.
Uses the Polygon REST API v2 aggregates endpoint.

Free tier: delayed data, limited calls/min
Starter tier: real-time data, 100 calls/min
"""
from __future__ import annotations
import asyncio
import logging
from datetime import datetime, timedelta
from typing import Optional

import httpx

from core.config import POLYGON_API_KEY, TIMEFRAMES
from core.models import Candle

logger = logging.getLogger("qmscan.polygon")

BASE_URL = "https://api.polygon.io"


class PolygonClient:
    """Async Polygon.io REST client."""

    def __init__(self, api_key: str = POLYGON_API_KEY):
        self.api_key = api_key
        self._client: Optional[httpx.AsyncClient] = None
        self._rate_limit_delay = 0.15  # 15 calls/sec safe limit for free tier

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(timeout=10.0)
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
        Fetch OHLCV bars for a ticker.
        Returns list of Candle objects sorted oldest → newest.
        """
        if not self.api_key:
            raise ValueError("POLYGON_API_KEY not set in .env")

        tf = TIMEFRAMES.get(timeframe)
        if not tf:
            raise ValueError(f"Unknown timeframe: {timeframe}")

        # Calculate date range
        end_date = datetime.utcnow()
        if timeframe == "15m":
            start_date = end_date - timedelta(days=7)
        elif timeframe == "1H":
            start_date = end_date - timedelta(days=30)
        elif timeframe == "1D":
            start_date = end_date - timedelta(days=365)
        else:  # 1W
            start_date = end_date - timedelta(days=365 * 3)

        url = (
            f"{BASE_URL}/v2/aggs/ticker/{ticker}/range"
            f"/{tf['multiplier']}/{tf['timespan']}"
            f"/{start_date.strftime('%Y-%m-%d')}"
            f"/{end_date.strftime('%Y-%m-%d')}"
        )
        params = {
            "adjusted": "true",
            "sort": "asc",
            "limit": limit,
            "apiKey": self.api_key,
        }

        await asyncio.sleep(self._rate_limit_delay)
        client = await self._get_client()

        try:
            resp = await client.get(url, params=params)
            resp.raise_for_status()
            data = resp.json()

            if data.get("status") != "OK" or not data.get("results"):
                return []

            candles = []
            for bar in data["results"]:
                candles.append(Candle(
                    timestamp=datetime.utcfromtimestamp(bar["t"] / 1000),
                    open=bar["o"],
                    high=bar["h"],
                    low=bar["l"],
                    close=bar["c"],
                    volume=bar.get("v", 0),
                    vwap=bar.get("vw", 0),
                ))
            return candles

        except httpx.HTTPStatusError as e:
            logger.warning(f"Polygon HTTP error {ticker}/{timeframe}: {e.response.status_code}")
            return []
        except Exception as e:
            logger.debug(f"Polygon error {ticker}/{timeframe}: {e}")
            return []

    async def get_quote(self, ticker: str) -> Optional[dict]:
        """Get the latest quote (bid/ask/last) for a ticker."""
        if not self.api_key:
            return None
        url = f"{BASE_URL}/v2/last/trade/{ticker}"
        params = {"apiKey": self.api_key}
        client = await self._get_client()
        try:
            resp = await client.get(url, params=params)
            data = resp.json()
            if data.get("status") == "OK":
                result = data["results"]
                return {"last": result.get("p"), "volume": result.get("s")}
        except Exception:
            pass
        return None
