"""
data/alpaca_client.py
Alpaca Markets data client.

Free paper trading account → IEX real-time data.
Paid subscription → SIP (full market) real-time data.

Uses alpaca-py SDK under the hood.
"""
from __future__ import annotations
import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx

from core.config import ALPACA_API_KEY, ALPACA_SECRET_KEY, ALPACA_PAPER, TIMEFRAMES, ALPACA_TIMEFRAME_MAP
from core.models import Candle

logger = logging.getLogger("qmscan.alpaca")

# Alpaca base URLs
DATA_URL = "https://data.alpaca.markets"
PAPER_URL = "https://paper-api.alpaca.markets"
LIVE_URL  = "https://api.alpaca.markets"


class AlpacaClient:
    """Async Alpaca Markets data client using direct REST calls."""

    def __init__(
        self,
        api_key: str = ALPACA_API_KEY,
        secret_key: str = ALPACA_SECRET_KEY,
        paper: bool = ALPACA_PAPER,
    ):
        self.api_key = api_key
        self.secret_key = secret_key
        self.paper = paper
        self._client: Optional[httpx.AsyncClient] = None
        self._rate_limit_delay = 0.2

    def _headers(self) -> dict:
        return {
            "APCA-API-KEY-ID": self.api_key,
            "APCA-API-SECRET-KEY": self.secret_key,
        }

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
        Fetch historical bars from Alpaca.
        Returns list of Candle objects sorted oldest → newest.
        """
        if not self.api_key or not self.secret_key:
            raise ValueError("ALPACA_API_KEY and ALPACA_SECRET_KEY must be set in .env")

        alpaca_tf = ALPACA_TIMEFRAME_MAP.get(timeframe, "1Day")

        end = datetime.now(timezone.utc)
        if timeframe == "15m":
            start = end - timedelta(days=5)
        elif timeframe == "1H":
            start = end - timedelta(days=30)
        elif timeframe == "1D":
            start = end - timedelta(days=400)
        else:
            start = end - timedelta(days=365 * 4)

        url = f"{DATA_URL}/v2/stocks/{ticker}/bars"
        params = {
            "timeframe": alpaca_tf,
            "start": start.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "end": end.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "limit": limit,
            "adjustment": "split",
            "feed": "iex",  # use "sip" if you have a paid subscription
            "sort": "asc",
        }

        await asyncio.sleep(self._rate_limit_delay)
        client = await self._get_client()

        try:
            resp = await client.get(url, params=params, headers=self._headers())
            resp.raise_for_status()
            data = resp.json()

            bars = data.get("bars", [])
            if not bars:
                return []

            candles = []
            for bar in bars:
                ts_str = bar["t"]
                # Handle both formats: "2024-01-01T09:30:00Z" and timestamp int
                if isinstance(ts_str, str):
                    ts = datetime.fromisoformat(ts_str.replace("Z", "+00:00")).replace(tzinfo=None)
                else:
                    ts = datetime.utcfromtimestamp(ts_str)

                candles.append(Candle(
                    timestamp=ts,
                    open=bar["o"],
                    high=bar["h"],
                    low=bar["l"],
                    close=bar["c"],
                    volume=bar.get("v", 0),
                    vwap=bar.get("vw", 0),
                ))
            return candles

        except httpx.HTTPStatusError as e:
            logger.warning(f"Alpaca HTTP error {ticker}/{timeframe}: {e.response.status_code} — {e.response.text[:200]}")
            return []
        except Exception as e:
            logger.debug(f"Alpaca error {ticker}/{timeframe}: {e}")
            return []

    async def get_latest_quote(self, ticker: str) -> Optional[dict]:
        """Get latest trade price and volume for a ticker."""
        url = f"{DATA_URL}/v2/stocks/{ticker}/trades/latest"
        params = {"feed": "iex"}
        client = await self._get_client()
        try:
            resp = await client.get(url, params=params, headers=self._headers())
            data = resp.json()
            trade = data.get("trade", {})
            return {
                "last": trade.get("p"),
                "volume": trade.get("s"),
                "timestamp": trade.get("t"),
            }
        except Exception:
            return None
