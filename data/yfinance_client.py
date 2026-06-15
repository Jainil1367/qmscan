"""
data/yfinance_client.py
Yahoo Finance data client via yfinance.

Free, no API key required. Supports 1m/5m/15m/30m/1h/1d/1wk/1mo.
"""
from __future__ import annotations
import logging
from typing import Optional

import yfinance as yf

from core.config import YFINANCE_TIMEFRAME_MAP
from core.models import Candle

logger = logging.getLogger("qmscan.yfinance")


class YFinanceClient:

    async def get_bars(self, ticker: str, timeframe: str, limit: int = 200) -> list[Candle]:
        interval = YFINANCE_TIMEFRAME_MAP.get(timeframe)
        if not interval:
            raise ValueError(f"Unknown timeframe: {timeframe}")

        from datetime import timezone, timedelta
        if timeframe == "15m":
            period = "60d"
        elif timeframe == "1H":
            period = "2y"
        elif timeframe == "1D":
            period = "2y"
        else:
            period = "5y"

        try:
            df = yf.download(
                ticker,
                period=period,
                interval=interval,
                progress=False,
                auto_adjust=True,
                multi_level_index=False,
            )
            if df is None or df.empty:
                return []

            # Flatten MultiIndex columns if present
            if isinstance(df.columns, __import__('pandas').MultiIndex):
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
            return candles[-limit:]

        except Exception as e:
            logger.debug(f"yfinance error {ticker}/{timeframe}: {e}")
            return []

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
