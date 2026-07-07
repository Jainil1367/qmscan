"""backtesting/universe.py — Clean NASDAQ-100 constituents for backtesting."""

# Verified tickers — no duplicates, all liquid, all on Yahoo Finance
# Removed: RIVN, LCID, KVUE, GFS, SIRI, MTCH, ZM, SPLK, SGEN (delisted/removed from NDX)
# Removed duplicates: CDNS, VRSK, CTSH appeared twice
NASDAQ_100 = [
    # Mega-cap tech
    "AAPL", "MSFT", "NVDA", "AMZN", "META", "TSLA", "GOOGL", "AVGO", "COST",
    # Large-cap tech
    "NFLX", "AMD",  "ADBE", "QCOM", "PEP",  "CSCO", "TMUS", "INTC", "INTU",
    "AMGN", "HON",  "AMAT", "BKNG", "ISRG", "VRTX", "MU",   "REGN", "ADP",
    "ADI",  "PANW", "LRCX", "SBUX", "SNPS", "KLAC", "GILD", "CDNS", "MDLZ",
    "PYPL", "CTAS", "MELI", "ABNB", "WDAY", "CRWD", "MNST", "ORLY", "FTNT",
    "NXPI", "MRVL", "PCAR", "ODFL", "DXCM", "PAYX", "ROST", "CHTR", "VRSK",
    "IDXX", "BIIB", "CTSH", "FAST", "EXC",  "DDOG", "ZS",   "CPRT", "ROP",
    "MCHP", "CSGP", "ANSS", "ON",   "DLTR", "LULU", "TEAM", "ENPH", "EBAY",
    "PLTR", "COIN", "SMCI", "APP",  "ARM",  "TTWO", "GEHC", "FANG", "CEG",
    "KDP",  "TTD",  "OKTA", "ILMN", "HOOD", "MSTR", "CELH",
]


def get_bt_universe(size: int = 100) -> list[str]:
    """Return up to `size` tickers, guaranteed unique."""
    seen = set()
    out  = []
    for t in NASDAQ_100:
        if t not in seen:
            seen.add(t)
            out.append(t)
    return out[:size]