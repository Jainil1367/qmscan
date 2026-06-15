import sys
sys.path.insert(0, '.')
import asyncio
from data.yfinance_client import YFinanceClient
from detectors.choch import detect_choch, find_swing_points
from detectors.fibonacci import analyze_fib_setup
from data.universe import get_universe

async def test():
    c = YFinanceClient()
    choch_count = 0
    for ticker in get_universe():
        bars = await c.get_bars(ticker, '1D', 200)
        if not bars or len(bars) < 50:
            print(f"{ticker}: insufficient bars ({len(bars) if bars else 0})")
            continue

        swings = find_swing_points(bars)
        highs = [s for s in swings if s.swing_type.value == 'high']
        lows  = [s for s in swings if s.swing_type.value == 'low']
        choch = detect_choch(bars)

        if choch:
            choch_count += 1
            setup = analyze_fib_setup(ticker, '1D', choch, bars)
            print(f"{ticker}: CHoCH={choch.direction} fib_impulse={choch.impulse_pct}% setup={setup.setup_name if setup else 'None — price not in zone'}")
        else:
            lh = highs[-1].price < highs[-2].price if len(highs) >= 2 else False
            ll = lows[-1].price < lows[-2].price if len(lows) >= 2 else False
            close = bars[-1].close
            broken = highs[-1].price if highs else 0
            print(f"{ticker}: no CHoCH — LH={lh} LL={ll} close={close:.2f} last_high={broken:.2f} broken={'YES' if close > broken else 'NO'}")

    print(f"\nTotal CHoCH: {choch_count}/{len(get_universe())}")

asyncio.run(test())
