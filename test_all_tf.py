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
    total = 0
    for tf in TIMEFRAMES:
        tf_setups = []
        for ticker in universe:
            bars = await c.get_bars(ticker, tf, 200)
            if not bars or len(bars) < 50:
                continue
            choch = detect_choch(bars)
            if not choch:
                continue
            setup = analyze_fib_setup(ticker, tf, choch, bars)
            if setup:
                tf_setups.append(f"  {ticker}: {setup.setup_name} fib={setup.fib_entry_pct}% RR={setup.risk_reward}")
        print(f"\n[{tf}] — {len(tf_setups)} setups:")
        for s in tf_setups:
            print(s)
        total += len(tf_setups)
    print(f"\nTotal across all timeframes: {total}")

asyncio.run(test())
