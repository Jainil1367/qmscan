"""
trades/trade_store.py
SQLite-backed trade log.

Stores all trades (simulated) with full lifecycle:
  PENDING → OPEN → CLOSED_WIN / CLOSED_LOSS / CLOSED_BE / CANCELLED

Also computes summary statistics for the dashboard.
"""
from __future__ import annotations
import asyncio
import json
import logging
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional

import aiosqlite

from core.config import DEFAULT_RISK_PCT, DEFAULT_ACCOUNT_SIZE
from core.models import DetectedSetup, Trade, TradeStatus

logger = logging.getLogger("qmscan.trades")

DB_PATH = Path(__file__).parent / "trades.db"


class TradeStore:
    def __init__(self, db_path: Path = DB_PATH):
        self.db_path = db_path
        self._db: Optional[aiosqlite.Connection] = None

    async def init(self):
        """Initialize the database and create tables."""
        self._db = await aiosqlite.connect(str(self.db_path))
        self._db.row_factory = aiosqlite.Row
        await self._db.execute("""
            CREATE TABLE IF NOT EXISTS trades (
                id TEXT PRIMARY KEY,
                ticker TEXT NOT NULL,
                timeframe TEXT,
                setup_id INTEGER,
                setup_name TEXT,
                entry REAL,
                stop_loss REAL,
                target REAL,
                risk_reward REAL,
                risk_pct REAL,
                account_size REAL,
                position_size REAL,
                risk_amount REAL,
                status TEXT DEFAULT 'pending',
                open_price REAL,
                close_price REAL,
                pnl REAL DEFAULT 0,
                pnl_r REAL DEFAULT 0,
                opened_at TEXT,
                closed_at TEXT,
                created_at TEXT,
                notes TEXT DEFAULT '',
                htf_confluent INTEGER DEFAULT 0,
                order_block INTEGER DEFAULT 0
            )
        """)
        await self._db.execute("""
            CREATE TABLE IF NOT EXISTS setup_history (
                id TEXT PRIMARY KEY,
                ticker TEXT NOT NULL,
                timeframe TEXT NOT NULL,
                setup_id INTEGER NOT NULL,
                setup_name TEXT NOT NULL,
                event TEXT NOT NULL,
                price REAL,
                entry REAL,
                stop_loss REAL,
                target REAL,
                risk_reward REAL,
                fib_entry_pct REAL,
                htf_confluent INTEGER DEFAULT 0,
                order_block INTEGER DEFAULT 0,
                stop_hunt_risk INTEGER DEFAULT 0,
                htf_trend TEXT,
                notes TEXT DEFAULT '',
                detected_at TEXT,
                logged_at TEXT NOT NULL
            )
        """)
        await self._db.execute(
            "CREATE INDEX IF NOT EXISTS idx_history_ticker ON setup_history(ticker)"
        )
        await self._db.execute(
            "CREATE INDEX IF NOT EXISTS idx_history_logged ON setup_history(logged_at DESC)"
        )
        await self._db.commit()
        logger.info(f"Trade store initialized at {self.db_path}")

    async def close(self):
        if self._db:
            await self._db.close()

    def _calc_position_size(
        self,
        entry: float,
        stop_loss: float,
        account_size: float = DEFAULT_ACCOUNT_SIZE,
        risk_pct: float = DEFAULT_RISK_PCT,
    ) -> tuple[float, float]:
        """
        Returns (position_size_shares, risk_amount_dollars).
        position_size = (account * risk_pct/100) / (entry - stop_loss)
        """
        risk_amount = account_size * (risk_pct / 100)
        risk_per_share = entry - stop_loss
        if risk_per_share <= 0:
            return 0.0, 0.0
        position_size = risk_amount / risk_per_share
        return round(position_size, 4), round(risk_amount, 2)

    async def add_from_setup(
        self,
        setup: DetectedSetup,
        account_size: float = DEFAULT_ACCOUNT_SIZE,
        risk_pct: float = DEFAULT_RISK_PCT,
        notes: str = "",
    ) -> Trade:
        """Create a new PENDING trade from a detected setup."""
        pos_size, risk_amount = self._calc_position_size(
            setup.entry, setup.stop_loss, account_size, risk_pct
        )
        trade = Trade(
            id=str(uuid.uuid4()),
            ticker=setup.ticker,
            timeframe=setup.timeframe,
            setup_id=setup.setup_id,
            setup_name=setup.setup_name,
            entry=setup.entry,
            stop_loss=setup.stop_loss,
            target=setup.target,
            risk_reward=setup.risk_reward,
            risk_pct=risk_pct,
            account_size=account_size,
            position_size=pos_size,
            risk_amount=risk_amount,
            status=TradeStatus.PENDING,
            notes=notes,
            htf_confluent=setup.htf_confluent,
            order_block=setup.order_block is not None,
        )
        await self._insert(trade)
        logger.info(f"Trade added: {trade.ticker} {trade.setup_name} — ${trade.risk_amount:.2f} risk")
        return trade

    async def open_trade(self, trade_id: str, open_price: float) -> Optional[Trade]:
        """Mark a PENDING trade as OPEN."""
        now = datetime.utcnow().isoformat()
        await self._db.execute("""
            UPDATE trades SET status='open', open_price=?, opened_at=?
            WHERE id=? AND status='pending'
        """, (open_price, now, trade_id))
        await self._db.commit()
        return await self.get_trade(trade_id)

    async def close_trade(
        self,
        trade_id: str,
        close_price: float,
        notes: str = "",
    ) -> Optional[Trade]:
        """Close an OPEN trade and compute P&L."""
        trade = await self.get_trade(trade_id)
        if not trade or trade.status != TradeStatus.OPEN:
            return None

        open_price = trade.open_price or trade.entry
        pnl = (close_price - open_price) * trade.position_size
        risk_per_share = open_price - trade.stop_loss
        pnl_r = pnl / (risk_per_share * trade.position_size) if risk_per_share > 0 else 0

        if close_price > open_price:
            status = TradeStatus.CLOSED_WIN
        elif close_price < open_price:
            status = TradeStatus.CLOSED_LOSS
        else:
            status = TradeStatus.CLOSED_BE

        now = datetime.utcnow().isoformat()
        combined_notes = f"{trade.notes}\n{notes}".strip() if notes else trade.notes
        await self._db.execute("""
            UPDATE trades SET
                status=?, close_price=?, pnl=?, pnl_r=?, closed_at=?, notes=?
            WHERE id=?
        """, (status.value, close_price, round(pnl, 2), round(pnl_r, 2), now, combined_notes, trade_id))
        await self._db.commit()
        return await self.get_trade(trade_id)

    async def cancel_trade(self, trade_id: str) -> bool:
        await self._db.execute(
            "UPDATE trades SET status='cancelled' WHERE id=? AND status IN ('pending','open')",
            (trade_id,)
        )
        await self._db.commit()
        return True

    async def get_trade(self, trade_id: str) -> Optional[Trade]:
        async with self._db.execute("SELECT * FROM trades WHERE id=?", (trade_id,)) as cur:
            row = await cur.fetchone()
            return self._row_to_trade(row) if row else None

    async def list_trades(
        self,
        status: Optional[str] = None,
        ticker: Optional[str] = None,
        limit: int = 100,
    ) -> list[Trade]:
        query = "SELECT * FROM trades WHERE 1=1"
        params: list = []
        if status:
            query += " AND status=?"
            params.append(status)
        if ticker:
            query += " AND ticker=?"
            params.append(ticker)
        query += " ORDER BY created_at DESC LIMIT ?"
        params.append(limit)
        async with self._db.execute(query, params) as cur:
            rows = await cur.fetchall()
            return [self._row_to_trade(r) for r in rows]

    async def get_stats(self) -> dict:
        """Compute summary stats for the trade log dashboard."""
        async with self._db.execute("""
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN status='closed_win' THEN 1 ELSE 0 END) as wins,
                SUM(CASE WHEN status='closed_loss' THEN 1 ELSE 0 END) as losses,
                SUM(CASE WHEN status='closed_be' THEN 1 ELSE 0 END) as be,
                SUM(CASE WHEN status IN ('closed_win','closed_loss','closed_be') THEN pnl ELSE 0 END) as total_pnl,
                SUM(CASE WHEN status IN ('closed_win','closed_loss','closed_be') THEN pnl_r ELSE 0 END) as total_r,
                AVG(CASE WHEN status='closed_win' THEN pnl_r ELSE NULL END) as avg_win_r,
                AVG(CASE WHEN status='closed_loss' THEN pnl_r ELSE NULL END) as avg_loss_r,
                AVG(risk_reward) as avg_rr
            FROM trades
        """) as cur:
            row = await cur.fetchone()

        total = row["total"] or 0
        wins = row["wins"] or 0
        losses = row["losses"] or 0
        closed = wins + losses + (row["be"] or 0)
        win_rate = round(wins / closed * 100, 1) if closed > 0 else 0.0

        return {
            "total_trades": total,
            "closed_trades": closed,
            "wins": wins,
            "losses": losses,
            "breakeven": row["be"] or 0,
            "win_rate": win_rate,
            "total_pnl": round(row["total_pnl"] or 0, 2),
            "total_r": round(row["total_r"] or 0, 2),
            "avg_win_r": round(row["avg_win_r"] or 0, 2),
            "avg_loss_r": round(row["avg_loss_r"] or 0, 2),
            "avg_rr_planned": round(row["avg_rr"] or 0, 2),
            "expectancy": round(
                (win_rate / 100 * (row["avg_win_r"] or 0)) +
                ((1 - win_rate / 100) * (row["avg_loss_r"] or 0)),
                2
            ),
        }

    async def log_setup_event(
        self,
        setup: DetectedSetup,
        event: str = "detected",
        notes: str = "",
    ) -> None:
        """
        Record a setup lifecycle event in setup_history.
        event: 'detected' | 'stopped_out' | 'target_hit' | 'expired'
        """
        now = datetime.utcnow().isoformat()
        row_id = f"{setup.id}_{event}"
        await self._db.execute("""
            INSERT OR IGNORE INTO setup_history (
                id, ticker, timeframe, setup_id, setup_name,
                event, price, entry, stop_loss, target,
                risk_reward, fib_entry_pct, htf_confluent,
                order_block, stop_hunt_risk, htf_trend,
                notes, detected_at, logged_at
            ) VALUES (?,?,?,?,?, ?,?,?,?,?, ?,?,?,?,?, ?,?,?,?)
        """, (
            row_id,
            setup.ticker, setup.timeframe, setup.setup_id, setup.setup_name,
            event, round(setup.current_price, 4),
            round(setup.entry, 4), round(setup.stop_loss, 4), round(setup.target, 4),
            setup.risk_reward, round(setup.fib_entry_pct, 1),
            1 if setup.htf_confluent else 0,
            1 if setup.order_block else 0,
            1 if setup.stop_hunt_risk else 0,
            setup.htf_trend,
            notes,
            setup.detected_at.isoformat(),
            now,
        ))
        await self._db.commit()

    async def get_history(
        self,
        ticker: Optional[str] = None,
        timeframe: Optional[str] = None,
        setup_id: Optional[int] = None,
        limit: int = 200,
    ) -> list[dict]:
        query = "SELECT * FROM setup_history WHERE 1=1"
        params: list = []
        if ticker:
            query += " AND ticker=?"
            params.append(ticker.upper())
        if timeframe:
            query += " AND timeframe=?"
            params.append(timeframe)
        if setup_id is not None:
            query += " AND setup_id=?"
            params.append(setup_id)
        query += " ORDER BY logged_at DESC LIMIT ?"
        params.append(limit)
        async with self._db.execute(query, params) as cur:
            rows = await cur.fetchall()
        return [dict(r) for r in rows]

    async def _insert(self, trade: Trade):
        await self._db.execute("""
            INSERT INTO trades VALUES (
                ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
            )
        """, (
            trade.id, trade.ticker, trade.timeframe, trade.setup_id, trade.setup_name,
            trade.entry, trade.stop_loss, trade.target, trade.risk_reward, trade.risk_pct,
            trade.account_size, trade.position_size, trade.risk_amount,
            trade.status.value, trade.open_price, trade.close_price,
            trade.pnl, trade.pnl_r,
            trade.opened_at.isoformat() if trade.opened_at else None,
            trade.closed_at.isoformat() if trade.closed_at else None,
            trade.created_at.isoformat(),
            trade.notes,
            1 if trade.htf_confluent else 0,
            1 if trade.order_block else 0,
        ))
        await self._db.commit()

    def _row_to_trade(self, row) -> Trade:
        def parse_dt(s):
            return datetime.fromisoformat(s) if s else None

        return Trade(
            id=row["id"],
            ticker=row["ticker"],
            timeframe=row["timeframe"] or "",
            setup_id=row["setup_id"] or 0,
            setup_name=row["setup_name"] or "",
            entry=row["entry"] or 0,
            stop_loss=row["stop_loss"] or 0,
            target=row["target"] or 0,
            risk_reward=row["risk_reward"] or 0,
            risk_pct=row["risk_pct"] or DEFAULT_RISK_PCT,
            account_size=row["account_size"] or DEFAULT_ACCOUNT_SIZE,
            position_size=row["position_size"] or 0,
            risk_amount=row["risk_amount"] or 0,
            status=TradeStatus(row["status"]),
            open_price=row["open_price"],
            close_price=row["close_price"],
            pnl=row["pnl"] or 0,
            pnl_r=row["pnl_r"] or 0,
            opened_at=parse_dt(row["opened_at"]),
            closed_at=parse_dt(row["closed_at"]),
            created_at=parse_dt(row["created_at"]) or datetime.utcnow(),
            notes=row["notes"] or "",
            htf_confluent=bool(row["htf_confluent"]),
            order_block=bool(row["order_block"]),
        )
