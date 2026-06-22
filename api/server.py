"""
api/server.py
FastAPI application — REST endpoints + WebSocket real-time feed.

REST Endpoints:
  GET  /api/watchlist                     — current watchlist (all timeframes)
  GET  /api/watchlist/{timeframe}         — watchlist for one timeframe
  GET  /api/setup/{setup_id}              — detail for one setup
  GET  /api/alerts                        — recent alerts
  POST /api/alerts/{alert_id}/ack         — acknowledge an alert
  GET  /api/trades                        — trade log
  POST /api/trades                        — add trade from setup
  PUT  /api/trades/{trade_id}/open        — mark trade open
  PUT  /api/trades/{trade_id}/close       — close trade
  DEL  /api/trades/{trade_id}             — cancel trade
  GET  /api/trades/stats                  — trade stats
  GET  /api/status                        — scanner status

WebSocket:
  WS   /ws                                — real-time watchlist + alerts push
"""
from __future__ import annotations
import asyncio
import json
import logging
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel

logger = logging.getLogger("qmscan.api")

# ── App ──────────────────────────────────────────────────────────────────────

def create_app(scanner, alert_engine, trade_store) -> FastAPI:
    app = FastAPI(title="QMScan API", version="1.0.0")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # WebSocket connection manager
    ws_manager = ConnectionManager()

    # Backtest engine (singleton per server lifetime)
    from backtesting.engine import BacktestEngine
    bt_engine = BacktestEngine(data_client=scanner.data_client)

    # Wire scanner and alerts → WebSocket broadcast
    async def on_watchlist_update(state: dict):
        await ws_manager.broadcast(state)

    async def on_alert(alert):
        await ws_manager.broadcast({"type": "alert", "alert": alert.to_dict()})

    scanner.on_watchlist_update = on_watchlist_update
    alert_engine.on_alert = on_alert

    # ── Static Files ──────────────────────────────────────────────────────────
    dashboard_dir = Path(__file__).parent.parent / "dashboard"
    static_dir = dashboard_dir / "static"

    if static_dir.exists():
        app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")

    @app.get("/", include_in_schema=False)
    async def serve_dashboard():
        index = dashboard_dir / "index.html"
        if index.exists():
            return FileResponse(str(index))
        return {"message": "QMScan API running. Dashboard not found."}

    # ── WebSocket ─────────────────────────────────────────────────────────────
    @app.websocket("/ws")
    async def websocket_endpoint(websocket: WebSocket):
        await ws_manager.connect(websocket)
        try:
            # Send current state immediately on connect
            await websocket.send_json(scanner.get_state())
            # Keep-alive ping loop
            while True:
                await asyncio.sleep(30)
                try:
                    await websocket.send_json({"type": "ping"})
                except Exception:
                    # Client disconnected between pings — exit cleanly
                    break
        except WebSocketDisconnect:
            pass
        except Exception:
            # Catches RuntimeError("send after close"), ConnectionResetError, etc.
            pass
        finally:
            # Always remove from manager, even on unexpected errors
            ws_manager.disconnect(websocket)

    # ── Watchlist ─────────────────────────────────────────────────────────────
    @app.get("/api/watchlist")
    async def get_watchlist():
        return {
            "watchlist": {
                tf: [s.to_dict() for s in setups]
                for tf, setups in scanner.watchlist.items()
            },
            "scan_count": scanner._scan_count,
            "last_scan": scanner._last_scan.isoformat() if scanner._last_scan else None,
        }

    @app.get("/api/watchlist/{timeframe}")
    async def get_watchlist_tf(timeframe: str):
        if timeframe not in scanner.watchlist:
            raise HTTPException(404, f"Unknown timeframe: {timeframe}")
        return {
            "timeframe": timeframe,
            "setups": [s.to_dict() for s in scanner.watchlist[timeframe]],
        }

    @app.get("/api/setup/{setup_id}")
    async def get_setup(setup_id: str):
        setup = scanner.get_setup_by_id(setup_id)
        if not setup:
            raise HTTPException(404, "Setup not found")
        return setup.to_dict()

    # ── Alerts ────────────────────────────────────────────────────────────────
    @app.get("/api/alerts")
    async def get_alerts(limit: int = 50):
        return {"alerts": alert_engine.get_history(limit)}

    @app.post("/api/alerts/{alert_id}/ack")
    async def ack_alert(alert_id: str):
        ok = alert_engine.acknowledge(alert_id)
        if not ok:
            raise HTTPException(404, "Alert not found")
        return {"acknowledged": True}

    # ── Trades ────────────────────────────────────────────────────────────────
    class AddTradeBody(BaseModel):
        setup_id: str
        account_size: float = 10000.0
        risk_pct: float = 1.0
        notes: str = ""

    @app.post("/api/trades")
    async def add_trade(body: AddTradeBody):
        setup = scanner.get_setup_by_id(body.setup_id)
        if not setup:
            raise HTTPException(404, f"Setup {body.setup_id} not found in watchlist")
        trade = await trade_store.add_from_setup(
            setup,
            account_size=body.account_size,
            risk_pct=body.risk_pct,
            notes=body.notes,
        )
        return trade.to_dict()

    @app.get("/api/trades")
    async def list_trades(status: str = None, ticker: str = None, limit: int = 100):
        trades = await trade_store.list_trades(status=status, ticker=ticker, limit=limit)
        return {"trades": [t.to_dict() for t in trades]}

    @app.get("/api/trades/stats")
    async def trade_stats():
        return await trade_store.get_stats()

    class OpenTradeBody(BaseModel):
        open_price: float

    @app.put("/api/trades/{trade_id}/open")
    async def open_trade(trade_id: str, body: OpenTradeBody):
        trade = await trade_store.open_trade(trade_id, body.open_price)
        if not trade:
            raise HTTPException(404, "Trade not found or not in PENDING status")
        return trade.to_dict()

    class CloseTradeBody(BaseModel):
        close_price: float
        notes: str = ""

    @app.put("/api/trades/{trade_id}/close")
    async def close_trade(trade_id: str, body: CloseTradeBody):
        trade = await trade_store.close_trade(trade_id, body.close_price, body.notes)
        if not trade:
            raise HTTPException(404, "Trade not found or not in OPEN status")
        return trade.to_dict()

    @app.delete("/api/trades/{trade_id}")
    async def cancel_trade(trade_id: str):
        ok = await trade_store.cancel_trade(trade_id)
        return {"cancelled": ok}

    # ── Candles endpoint (for float chart TF switcher) ───────────────────────
    @app.get("/api/candles/{ticker}/{timeframe}")
    async def get_candles(ticker: str, timeframe: str, limit: int = 200):
        try:
            candles = await scanner.data_client.get_bars(ticker.upper(), timeframe, limit=limit)
            return {"candles": [c.to_dict() for c in candles], "count": len(candles)}
        except Exception as e:
            return {"candles": [], "error": str(e)}

    # ── Setup History ─────────────────────────────────────────────────────────
    @app.get("/api/history")
    async def get_history(
        ticker: str = None,
        timeframe: str = None,
        setup_id: int = None,
        limit: int = 200,
    ):
        rows = await trade_store.get_history(
            ticker=ticker, timeframe=timeframe,
            setup_id=setup_id, limit=limit,
        )
        return {"history": rows, "count": len(rows)}

    # ── Backtesting ───────────────────────────────────────────────────────────
    class BacktestRunBody(BaseModel):
        tickers: list[str] = []
        timeframes: list[str] = ["1H", "4H", "1D", "1W"]
        years: int = 5
        max_tickers: int = 50

    @app.post("/api/backtest/run")
    async def run_backtest(body: BacktestRunBody):
        if bt_engine._running:
            return {"started": False, "message": "Backtest already running"}
        from backtesting.universe import get_bt_universe
        tickers = body.tickers if body.tickers else get_bt_universe(body.max_tickers)
        tfs = [tf for tf in body.timeframes if tf in ("1H", "4H", "1D", "1W")]
        if not tfs:
            tfs = ["1H", "4H", "1D", "1W"]
        ok = bt_engine.start(tickers=tickers, timeframes=tfs, years=body.years)
        return {"started": ok, "tickers": len(tickers), "timeframes": tfs}

    @app.post("/api/backtest/cancel")
    async def cancel_backtest():
        bt_engine.cancel()
        return {"cancelled": True}

    @app.get("/api/backtest/status")
    async def backtest_status():
        return bt_engine.get_status()

    @app.get("/api/backtest/results")
    async def backtest_results():
        r = bt_engine.get_results()
        if r is None:
            raise HTTPException(404, "No backtest results available. Run a backtest first.")
        return r

    # ── Status ────────────────────────────────────────────────────────────────
    @app.get("/api/status")
    async def status():
        return {
            "running": scanner._running,
            "scan_count": scanner._scan_count,
            "last_scan": scanner._last_scan.isoformat() if scanner._last_scan else None,
            "universe_size": len(scanner.universe),
            "timeframes": scanner.timeframes,
            "total_setups": sum(len(v) for v in scanner.watchlist.values()),
        }

    return app


# ── WebSocket Manager ────────────────────────────────────────────────────────

class ConnectionManager:
    def __init__(self):
        self.active: list[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active.append(ws)
        logger.info(f"WS client connected ({len(self.active)} total)")

    def disconnect(self, ws: WebSocket):
        try:
            self.active.remove(ws)
        except ValueError:
            pass   # already removed by broadcast's dead-cleanup
        logger.info(f"WS client disconnected ({len(self.active)} remaining)")

    async def broadcast(self, data: dict):
        dead = []
        for ws in self.active:
            try:
                await ws.send_json(data)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.active.remove(ws)