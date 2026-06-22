"""
backtesting/universe.py
NASDAQ-100 constituents for backtesting.
"""

NASDAQ_100 = [
    "AAPL", "MSFT", "NVDA", "AMZN", "META", "TSLA", "GOOGL", "GOOG", "AVGO", "COST",
    "NFLX", "AMD", "ADBE", "QCOM", "PEP", "CSCO", "TMUS", "INTC", "INTU", "CMCSA",
    "AMGN", "HON", "AMAT", "BKNG", "ISRG", "VRTX", "MU", "REGN", "ADP", "ADI",
    "PANW", "LRCX", "SBUX", "SNPS", "KLAC", "GILD", "CDNS", "MDLZ", "PYPL", "CTAS",
    "MELI", "ABNB", "WDAY", "CRWD", "MNST", "CEG", "ORLY", "FTNT", "NXPI", "MRVL",
    "PCAR", "KDP", "ODFL", "TTD", "DXCM", "FANG", "PAYX", "ROST", "CHTR", "VRSK",
    "IDXX", "BIIB", "CTSH", "GEHC", "FAST", "EXC", "CCEP", "DDOG", "ZS", "CPRT",
    "SIRI", "ROP", "MCHP", "CSGP", "ANSS", "ON", "DLTR", "LULU", "TEAM", "SPLK",
    "ILMN", "ENPH", "ZM", "RIVN", "LCID", "EBAY", "MTCH", "OKTA", "HOOD", "SGEN",
    "MSTR", "PLTR", "COIN", "SMCI", "APP", "CELH", "ARM", "KVUE", "GFS", "TTWO",
]

def get_bt_universe(size: int = 100) -> list[str]:
    return NASDAQ_100[:size]