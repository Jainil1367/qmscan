"""backtesting/universe.py — NASDAQ-100 tickers for backtesting."""

NASDAQ_100 = [
    "AAPL", "MSFT", "NVDA", "AMZN", "META", "TSLA", "GOOGL", "AVGO", "COST", "NFLX",
    "AMD",  "ADBE", "QCOM", "PEP",  "CSCO", "TMUS", "INTC",  "INTU", "AMGN", "HON",
    "AMAT", "BKNG", "ISRG", "VRTX", "MU",   "REGN", "ADP",   "ADI",  "PANW", "LRCX",
    "SBUX", "SNPS", "KLAC", "GILD", "CDNS", "MDLZ", "PYPL",  "CTAS", "MELI", "ABNB",
    "WDAY", "CRWD", "MNST", "ORLY", "FTNT", "NXPI", "MRVL",  "PCAR", "ODFL", "DXCM",
    "PAYX", "ROST", "CHTR", "VRSK", "IDXX", "BIIB", "CTSH",  "FAST", "EXC",  "DDOG",
    "ZS",   "CPRT", "ROP",  "MCHP", "CSGP", "ANSS", "ON",    "DLTR", "LULU", "TEAM",
    "ENPH", "EBAY", "SGEN", "PLTR", "COIN", "SMCI", "APP",   "ARM",  "TTWO", "GEHC",
    "FANG", "CEG",  "KDP",  "TTD",  "OKTA", "ILMN", "RIVN",  "LCID", "HOOD", "MSTR",
    "CELH", "KVUE", "GFS",  "SIRI", "MTCH", "ZM",   "SPLK",  "VRSK", "CDNS", "CTSH",
]

def get_bt_universe(size: int = 100) -> list[str]:
    seen = set()
    out  = []
    for t in NASDAQ_100:
        if t not in seen:
            seen.add(t)
            out.append(t)
    return out[:size]
