"""
run.py — QMScan entry point.
"""
import asyncio
import argparse
import logging
import sys
import io
from pathlib import Path

import uvicorn
from rich.console import Console
from rich.panel import Panel
from rich.text import Text

# ── Ensure dirs ───────────────────────────────────────────────────────────────
Path("logs").mkdir(exist_ok=True)
Path("trades").mkdir(exist_ok=True)

# ── Logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    handlers=[
        logging.StreamHandler(io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')),
        logging.FileHandler("logs/qmscan.log", mode="a", encoding="utf-8"),
    ],
)
logger = logging.getLogger("qmscan")
console = Console()


async def main(host: str, port: int):
    console.print(Panel(
        Text.assemble(
            ("QM", "bold white"), ("*", "bold green"), ("SCAN", "bold white"),
            (" -- ICT Fibonacci Watchlist System\n", "dim"),
            ("Powered by QM (CHoCH) pattern detection + ", "dim"),
            ("Finnhub.io", "cyan"),
        ),
        subtitle="[dim]github.com/yourrepo/qmscan[/dim]",
        border_style="bright_blue",
    ))

    # ── Data Provider ─────────────────────────────────────────────────────────
    from data.yfinance_client import YFinanceClient
    data_client = YFinanceClient()
    console.print("[green]OK[/green] Data provider: [cyan]Yahoo Finance (free, no key)[/cyan]")

    # ── Alert Engine ──────────────────────────────────────────────────────────
    from alerts.alert_engine import AlertEngine
    alert_engine = AlertEngine()
    console.print("[green]OK[/green] Alert engine initialized")

    # ── Trade Store ───────────────────────────────────────────────────────────
    from trades.trade_store import TradeStore
    trade_store = TradeStore()
    await trade_store.init()
    console.print("[green]OK[/green] Trade store (SQLite) initialized")

    # ── Universe ──────────────────────────────────────────────────────────────
    from data.universe import get_universe
    universe = get_universe()
    console.print(f"[green]OK[/green] Universe: [yellow]{len(universe)}[/yellow] symbols loaded")

    # ── Scanner ───────────────────────────────────────────────────────────────
    from core.scanner import Scanner
    scanner = Scanner(
        data_client=data_client,
        alert_engine=alert_engine,
        universe=universe,
    )
    console.print("[green]OK[/green] Scanner initialized")

    # ── FastAPI App ───────────────────────────────────────────────────────────
    from api.server import create_app
    app = create_app(scanner, alert_engine, trade_store)
    console.print("[green]OK[/green] API server ready")

    console.print(Panel(
        f"[bold green]Dashboard:[/bold green] http://{'localhost' if host == '0.0.0.0' else host}:{port}\n"
        f"[bold cyan]API Docs:[/bold cyan]   http://{'localhost' if host == '0.0.0.0' else host}:{port}/docs\n"
        f"[bold yellow]Scanning:[/bold yellow]   {len(universe)} symbols x 4 timeframes every 60s\n"
        f"[bold white]Press Ctrl+C to stop[/bold white]",
        border_style="green",
    ))

    config = uvicorn.Config(
        app,
        host=host,
        port=port,
        log_level="warning",
        ws_ping_interval=20,
        ws_ping_timeout=10,
    )
    server = uvicorn.Server(config)

    await asyncio.gather(
        scanner.start(),
        server.serve(),
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="QMScan -- ICT Fibonacci Watchlist")
    parser.add_argument("--host", default=None)
    parser.add_argument("--port", type=int, default=None)
    args = parser.parse_args()

    from core.config import HOST, PORT
    asyncio.run(main(
        host=args.host or HOST,
        port=args.port or PORT,
    ))
