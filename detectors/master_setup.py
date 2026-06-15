"""
detectors/master_setup.py
Master Setup detector — finds stocks that have ICT Fibonacci setups
active on 2 or more timeframes simultaneously.

Scoring:
  - Each timeframe with an active setup contributes points
  - Setup quality bonus: Golden Zone=4, Deep=3, Typical=2, Impulsive=1
  - HTF confluence adds +2 per timeframe
  - Minimum 2 timeframes required to qualify
"""
from __future__ import annotations
from dataclasses import dataclass
from typing import Optional
from core.models import DetectedSetup, Candle, CHoCH
from core.config import TIMEFRAMES
from datetime import datetime


SETUP_QUALITY = {1: 1, 2: 2, 3: 4, 4: 3}


@dataclass
class MasterSetupResult:
    ticker: str
    timeframe_setups: dict[str, DetectedSetup]   # tf -> setup
    score: int
    best_setup: DetectedSetup                     # highest scoring individual setup
    detected_at: datetime

    @property
    def tf_count(self) -> int:
        return len(self.timeframe_setups)

    @property
    def setup_ids(self) -> list[int]:
        return [s.setup_id for s in self.timeframe_setups.values()]

    @property
    def timeframes_str(self) -> str:
        return " + ".join(
            f"{tf}(S{s.setup_id})" for tf, s in self.timeframe_setups.items()
        )

    def to_dict(self) -> dict:
        best = self.best_setup
        d = best.to_dict()
        d['id'] = f"MASTER_{self.ticker}"
        d['setup_id'] = 5
        d['setup_name'] = 'Master Setup'
        d['master_score'] = self.score
        d['master_tf_count'] = self.tf_count
        d['master_timeframes'] = self.timeframes_str
        d['master_setup_ids'] = self.setup_ids
        return d


def evaluate_master_setup(
    ticker: str,
    tf_setups: dict[str, Optional[DetectedSetup]],
) -> Optional[MasterSetupResult]:
    """
    Given a dict of {timeframe: DetectedSetup or None},
    return a MasterSetupResult if 2+ timeframes have active setups.
    """
    active = {tf: s for tf, s in tf_setups.items() if s is not None}

    if len(active) < 2:
        return None

    # Score each active timeframe
    score = 0
    for tf, setup in active.items():
        score += SETUP_QUALITY.get(setup.setup_id, 1)
        if setup.htf_confluent:
            score += 2

    # Pick the best individual setup (highest quality setup_id score)
    best = max(active.values(), key=lambda s: SETUP_QUALITY.get(s.setup_id, 1))

    return MasterSetupResult(
        ticker=ticker,
        timeframe_setups=active,
        score=score,
        best_setup=best,
        detected_at=datetime.utcnow(),
    )
