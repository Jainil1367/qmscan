# QMScan — ICT Fibonacci Watchlist System

A production-ready stock scanner built on QM (CHoCH) patterns with all 4 ICT Fibonacci setups,
live data via yfinance, real-time alerts, HTF confluence, OB detection, and a trade log.

Access the Deployed Website - https://qmscan.onrender.com/
## Folder Structure

```
qmscan/
├── README.md
├── requirements.txt
├── .env.example
├── run.py                        # Entry point — starts everything
│
├── core/
│   ├── __init__.py
│   ├── config.py                 # All settings, constants, Fib levels
│   ├── models.py                 # Dataclasses: Candle, Setup, Trade, Alert
│   └── scanner.py                # Main scan loop — orchestrates all detectors
│
├── detectors/
│   ├── __init__.py
│   ├── choch.py                  # CHoCH (Change of Character) detector
│   ├── fibonacci.py              # Fib retracement calculator + setup classifier
│   ├── order_block.py            # OB detector (for Setup 3 Golden Zone)
│   └── htf_confluence.py         # Multi-timeframe alignment checker
│
├── data/
│   ├── __init__.py
│   ├── polygon_client.py         # Polygon.io REST + WebSocket client
│   ├── alpaca_client.py          # Alpaca Markets REST + stream client
│   ├── cache.py                  # In-memory + SQLite candle cache
│   └── universe.py               # Stock universe definition
│
├── alerts/
│   ├── __init__.py
│   ├── alert_engine.py           # Alert dispatcher — routes to all channels
│   ├── sound_alert.py            # System sound / beep alerts
│   └── push_alert.py             # Desktop push notifications (plyer)
│
├── api/
│   ├── __init__.py
│   └── server.py                 # FastAPI server — REST + WebSocket for dashboard
│
├── dashboard/
│   ├── index.html                # Main dashboard UI
│   └── static/
│       ├── css/
│       │   └── style.css         # All dashboard styles
│       └── js/
│           ├── app.js            # Main dashboard JS — state, routing
│           ├── charts.js         # Lightweight Charts integration
│           ├── watchlist.js      # Watchlist rendering
│           └── tradelog.js       # Trade log UI
│
├── trades/
│   └── trade_store.py            # SQLite trade log CRUD
│
├── logs/
│   └── (auto-generated log files)
│
└── tests/
    ├── test_fibonacci.py
    ├── test_choch.py
    └── test_confluence.py
```

## Quick Start

```bash
# 1. Install dependencies
pip install -r requirements.txt

# 2. Set up environment
cp .env.example .env
# Edit .env and add your API keys

# 3. Run
python run.py

# 4. Open dashboard
# http://localhost:8000
```

## API Keys Needed

- **Polygon.io** — https://polygon.io (free tier works for EOD; paid for real-time)
- **Alpaca** — https://alpaca.markets (free paper trading account for real-time data)

## Setup Logic (from image)

| # | Name | Entry Fib | SL Fib | Notes |
|---|------|-----------|--------|-------|
| 1 | Impulsive Move | ~38.2% | 61.8% | Fast retracement after strong move |
| 2 | Typical Correction | 50–61.8% | 88.6% | Standard pullback zone |
| 3 | Golden Zone | ~78.6% | 113% | OB required, best R/R |
| 4 | Deep Correction | ~88.6% | 113% | Stop hunt likely, very deep |
