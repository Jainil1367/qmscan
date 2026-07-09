"""
data/store.py — SQLite OHLCV data store.

Stores historical candles for every ticker/timeframe locally.
Backtest reads from here instantly — no network calls needed.

Schema:
  candles(ticker TEXT, timeframe TEXT, ts INTEGER, open REAL,
          high REAL, low REAL, close REAL, volume REAL)
  download_log(ticker TEXT, timeframe TEXT, downloaded_at INTEGER,
               bar_count INTEGER, period TEXT)
"""
from __future__ import annotations
import asyncio
import logging
import os
import sqlite3
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

from core.models import Candle

logger = logging.getLogger("qmscan.store")

# Default location — persists across restarts on Render paid tier
# On free tier it resets on redeploy, but survives restarts
import os as _os
import pathlib as _pathlib

# Use absolute path so it works regardless of working directory
# On Render: /opt/render/project/src/data/ohlcv.db
# Locally:   <project_root>/data/ohlcv.db
_HERE    = _pathlib.Path(__file__).resolve().parent          # data/
_DEFAULT = str(_HERE / "ohlcv.db")
DB_PATH  = _os.getenv("OHLCV_DB_PATH", _DEFAULT)

# How old cached data can be before we re-download (hours)
STALE_HOURS = {
    "1H":  4,
    "4H":  8,
    "1D":  24,
    "1W":  168,   # 1 week
}


def _get_conn(path: str = DB_PATH) -> sqlite3.Connection:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, check_same_thread=False)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    return conn


def init_db(path: str = DB_PATH) -> None:
    """Create tables if they don't exist."""
    conn = _get_conn(path)
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS candles (
            ticker    TEXT NOT NULL,
            timeframe TEXT NOT NULL,
            ts        INTEGER NOT NULL,
            open      REAL NOT NULL,
            high      REAL NOT NULL,
            low       REAL NOT NULL,
            close     REAL NOT NULL,
            volume    REAL NOT NULL DEFAULT 0,
            PRIMARY KEY (ticker, timeframe, ts)
        );

        CREATE INDEX IF NOT EXISTS idx_candles_lookup
            ON candles(ticker, timeframe, ts DESC);

        CREATE TABLE IF NOT EXISTS download_log (
            ticker        TEXT NOT NULL,
            timeframe     TEXT NOT NULL,
            downloaded_at INTEGER NOT NULL,
            bar_count     INTEGER NOT NULL,
            period        TEXT NOT NULL,
            PRIMARY KEY (ticker, timeframe)
        );
    """)
    conn.commit()
    conn.close()
    logger.info(f"OHLCV store initialised at {path}")


def store_candles(ticker: str, timeframe: str,
                  candles: list[Candle], period: str = "5y",
                  path: str = DB_PATH) -> int:
    """
    Insert or replace candles for a ticker/timeframe.
    Returns number of rows stored.
    """
    if not candles:
        return 0

    conn = _get_conn(path)
    rows = [
        (ticker, timeframe,
         int(c.timestamp.timestamp()),
         c.open, c.high, c.low, c.close, c.volume)
        for c in candles
    ]
    conn.executemany(
        "INSERT OR REPLACE INTO candles VALUES (?,?,?,?,?,?,?,?)", rows
    )
    conn.execute(
        """INSERT OR REPLACE INTO download_log VALUES (?,?,?,?,?)""",
        (ticker, timeframe, int(time.time()), len(candles), period)
    )
    conn.commit()
    conn.close()
    return len(rows)


def load_candles(ticker: str, timeframe: str,
                 limit: int = 0, path: str = DB_PATH) -> list[Candle]:
    """
    Load candles from SQLite. Returns empty list if nothing stored.
    """
    conn = _get_conn(path)
    if limit > 0:
        rows = conn.execute(
            """SELECT ts, open, high, low, close, volume
               FROM candles WHERE ticker=? AND timeframe=?
               ORDER BY ts ASC LIMIT ?""",
            (ticker, timeframe, limit)
        ).fetchall()
    else:
        rows = conn.execute(
            """SELECT ts, open, high, low, close, volume
               FROM candles WHERE ticker=? AND timeframe=?
               ORDER BY ts ASC""",
            (ticker, timeframe)
        ).fetchall()
    conn.close()

    return [
        Candle(
            timestamp=datetime.utcfromtimestamp(ts),
            open=o, high=h, low=l, close=c, volume=v, vwap=0.0,
        )
        for ts, o, h, l, c, v in rows
    ]


def is_fresh(ticker: str, timeframe: str, path: str = DB_PATH) -> bool:
    """
    Returns True if cached data is recent enough (not stale).
    """
    conn = _get_conn(path)
    row = conn.execute(
        "SELECT downloaded_at FROM download_log WHERE ticker=? AND timeframe=?",
        (ticker, timeframe)
    ).fetchone()
    conn.close()

    if not row:
        return False

    age_hours = (time.time() - row[0]) / 3600
    stale_threshold = STALE_HOURS.get(timeframe, 24)
    return age_hours < stale_threshold


def get_download_status(path: str = DB_PATH) -> dict:
    """Return summary of what's stored."""
    conn = _get_conn(path)
    rows = conn.execute(
        """SELECT ticker, timeframe, bar_count, downloaded_at, period
           FROM download_log ORDER BY ticker, timeframe"""
    ).fetchall()
    conn.close()
    return {
        "entries": [
            {
                "ticker": r[0], "timeframe": r[1],
                "bars": r[2],
                "downloaded_at": datetime.utcfromtimestamp(r[3]).isoformat(),
                "period": r[4],
            }
            for r in rows
        ],
        "total_entries": len(rows),
    }


def clear_ticker(ticker: str, path: str = DB_PATH) -> None:
    conn = _get_conn(path)
    conn.execute("DELETE FROM candles WHERE ticker=?", (ticker,))
    conn.execute("DELETE FROM download_log WHERE ticker=?", (ticker,))
    conn.commit()
    conn.close()


def db_size_mb(path: str = DB_PATH) -> float:
    try:
        return Path(path).stat().st_size / 1_048_576
    except FileNotFoundError:
        return 0.0