"""
data/universe.py
Stock universe definition.
Edit UNIVERSE_FULL to add/remove symbols.
The scanner uses the first UNIVERSE_SIZE symbols from this list.
"""
from __future__ import annotations
from core.config import UNIVERSE_SIZE

# Full watchable universe — 80 liquid symbols across sectors
UNIVERSE_FULL: list[dict] = [
    # Crypto
    {"ticker": "BTC-USD", "name": "Bitcoin",              "sector": "Crypto"},
    # Mega-cap Tech
    {"ticker": "AAPL",  "name": "Apple Inc",            "sector": "Tech"},
    {"ticker": "MSFT",  "name": "Microsoft Corp",       "sector": "Tech"},
    {"ticker": "NVDA",  "name": "NVIDIA Corp",          "sector": "Semi"},
    {"ticker": "GOOGL", "name": "Alphabet Inc",         "sector": "Tech"},
    {"ticker": "META",  "name": "Meta Platforms",       "sector": "Tech"},
    {"ticker": "AMZN",  "name": "Amazon.com",           "sector": "Tech"},
    {"ticker": "TSLA",  "name": "Tesla Inc",            "sector": "EV"},
    # Semiconductors
    {"ticker": "AMD",   "name": "Advanced Micro Dev",   "sector": "Semi"},
    {"ticker": "ARM",   "name": "Arm Holdings",         "sector": "Semi"},
    {"ticker": "INTC",  "name": "Intel Corp",           "sector": "Semi"},
    {"ticker": "QCOM",  "name": "Qualcomm",             "sector": "Semi"},
    {"ticker": "MU",    "name": "Micron Technology",    "sector": "Semi"},
    {"ticker": "AVGO",  "name": "Broadcom Inc",         "sector": "Semi"},
    # AI / Cloud
    {"ticker": "PLTR",  "name": "Palantir Tech",        "sector": "AI"},
    {"ticker": "SMCI",  "name": "Super Micro Computer", "sector": "AI"},
    {"ticker": "CRM",   "name": "Salesforce",           "sector": "Cloud"},
    {"ticker": "NOW",   "name": "ServiceNow",           "sector": "Cloud"},
    {"ticker": "SNOW",  "name": "Snowflake",            "sector": "Cloud"},
    # Fintech / Finance
    {"ticker": "SOFI",  "name": "SoFi Technologies",    "sector": "Fin"},
    {"ticker": "COIN",  "name": "Coinbase Global",      "sector": "Crypto"},
    {"ticker": "HOOD",  "name": "Robinhood Markets",    "sector": "Fin"},
    {"ticker": "XYZ",    "name": "Block Inc",            "sector": "Fin"},
    {"ticker": "PYPL",  "name": "PayPal Holdings",      "sector": "Fin"},
    # EV / Energy
    {"ticker": "RIVN",  "name": "Rivian Automotive",   "sector": "EV"},
    {"ticker": "NIO",   "name": "NIO Inc",              "sector": "EV"},
    {"ticker": "LCID",  "name": "Lucid Group",          "sector": "EV"},
    # Healthcare / Bio
    {"ticker": "MRNA",  "name": "Moderna Inc",          "sector": "Bio"},
    {"ticker": "NVAX",  "name": "Novavax Inc",          "sector": "Bio"},
    {"ticker": "CRSP",  "name": "CRISPR Therapeutics",  "sector": "Bio"},
    # ETFs
    {"ticker": "SPY",   "name": "S&P 500 ETF",          "sector": "ETF"},
    {"ticker": "QQQ",   "name": "Nasdaq-100 ETF",       "sector": "ETF"},
    {"ticker": "IWM",   "name": "Russell 2000 ETF",     "sector": "ETF"},
    {"ticker": "SOXS",  "name": "Semi Bear 3x ETF",     "sector": "ETF"},
    # Other high-vol
    {"ticker": "MSTR",  "name": "MicroStrategy",        "sector": "BTC"},
    {"ticker": "MARA",  "name": "Marathon Digital",     "sector": "BTC"},
    {"ticker": "RIOT",  "name": "Riot Platforms",       "sector": "BTC"},
    {"ticker": "GME",   "name": "GameStop Corp",        "sector": "Meme"},
    {"ticker": "AMC",   "name": "AMC Entertainment",    "sector": "Meme"},
    {"ticker": "NFLX",  "name": "Netflix Inc",          "sector": "Media"},
    {"ticker": "DIS",   "name": "Walt Disney Co",       "sector": "Media"},
    {"ticker": "UBER",  "name": "Uber Technologies",    "sector": "Tech"},
    {"ticker": "LYFT",  "name": "Lyft Inc",             "sector": "Tech"},
    {"ticker": "ABNB",  "name": "Airbnb Inc",           "sector": "Travel"},
    {"ticker": "BKNG",  "name": "Booking Holdings",     "sector": "Travel"},
    {"ticker": "F",     "name": "Ford Motor Co",        "sector": "Auto"},
    {"ticker": "GM",    "name": "General Motors",       "sector": "Auto"},
    {"ticker": "BAC",   "name": "Bank of America",      "sector": "Bank"},
    {"ticker": "JPM",   "name": "JPMorgan Chase",       "sector": "Bank"},
    {"ticker": "GS",    "name": "Goldman Sachs",        "sector": "Bank"},
    {"ticker": "MS",    "name": "Morgan Stanley",       "sector": "Bank"},
]

# Metadata lookup by ticker
UNIVERSE_META: dict[str, dict] = {u["ticker"]: u for u in UNIVERSE_FULL}


def get_universe(size: int = UNIVERSE_SIZE) -> list[str]:
    """Return list of ticker strings up to `size`."""
    return [u["ticker"] for u in UNIVERSE_FULL[:size]]


def get_meta(ticker: str) -> dict:
    """Return name/sector metadata for a ticker."""
    return UNIVERSE_META.get(ticker, {"ticker": ticker, "name": ticker, "sector": "Unknown"})
