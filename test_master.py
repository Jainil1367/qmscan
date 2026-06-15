import sys, asyncio
sys.path.insert(0, '.')
from data.yfinance_client import YFinanceClient
from detectors.choch import detect_choch
from detectors.fibonacci import analyze_fib_setup
from data.universe import get_universe
from core.config import TIMEFRAMES

async def test():
    c = YFinanceClient()
    universe = get_universe()
    timeframes = list(TIMEFRAMES.keys())

    # For each ticker, collect which setups it has per timeframe
    for ticker in universe:
        results = {}
        for tf in timeframes:
            bars = await c.get_bars(ticker, tf, 200)
            if not bars or len(bars) < 50:
                continue
            choch = detect_choch(bars)
            if not choch:
                continue
            setup = analyze_fib_setup(ticker, tf, choch, bars)
            if setup:
                results[tf] = setup.setup_id

        if len(results) == 4:
            print(f"ALL 4 TF: {ticker} -> {results}")
        elif len(results) >= 2:
            print(f"  {len(results)}/4 TF: {ticker} -> {results}")

asyncio.run(test())
