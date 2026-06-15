"""
alerts/alert_engine.py
Central alert dispatcher.

Receives DetectedSetup objects from the scanner, deduplicates based on
cooldown window, determines severity, and routes to all alert channels.
"""
from __future__ import annotations
import asyncio
import logging
import uuid
from datetime import datetime, timedelta
from typing import Callable, Awaitable, Optional

from core.config import ALERT_COOLDOWN_SECONDS, ENABLE_SOUND_ALERTS, ENABLE_PUSH_ALERTS
from core.models import DetectedSetup, Alert, AlertSeverity

logger = logging.getLogger("qmscan.alerts")


def _determine_severity(setup: DetectedSetup) -> AlertSeverity:
    """
    Score the setup and return an alert severity level.
    CRITICAL: HTF confluent + OB + high R/R
    HIGH:     HTF confluent + high R/R
    MEDIUM:   HTF confluent OR high R/R
    LOW:      basic setup, no confluence
    """
    score = 0
    if setup.htf_confluent:
        score += 2
    if setup.order_block:
        score += 2
    if setup.risk_reward >= 3.0:
        score += 2
    elif setup.risk_reward >= 2.0:
        score += 1
    if setup.setup_id == 3:  # Golden Zone is premium
        score += 1

    if score >= 6:
        return AlertSeverity.CRITICAL
    elif score >= 4:
        return AlertSeverity.HIGH
    elif score >= 2:
        return AlertSeverity.MEDIUM
    return AlertSeverity.LOW


def _build_message(setup: DetectedSetup, severity: AlertSeverity) -> str:
    flags = []
    if setup.htf_confluent:
        flags.append("HTF [OK]")
    if setup.order_block:
        flags.append("OB [OK]")
    if setup.stop_hunt_risk:
        flags.append("Stop Hunt Risk [!]")
    flag_str = "  " + " | ".join(flags) if flags else ""

    return (
        f"[{severity.value.upper()}] {setup.ticker} — Setup {setup.setup_id}: {setup.setup_name}"
        f"  [{setup.timeframe}] @ ${setup.current_price:.2f}"
        f"  Entry: ${setup.entry:.2f} | SL: ${setup.stop_loss:.2f} | TP: ${setup.target:.2f}"
        f"  R/R: {setup.risk_reward}R{flag_str}"
    )


class AlertEngine:
    """
    Manages alert deduplication, severity scoring, and routing.
    """

    def __init__(self):
        # Cooldown tracking: key = f"{ticker}_{setup_id}_{timeframe}"
        self._cooldowns: dict[str, datetime] = {}
        self._alert_history: list[Alert] = []

        # Pluggable channels
        self._sound_enabled = ENABLE_SOUND_ALERTS
        self._push_enabled = ENABLE_PUSH_ALERTS

        # WebSocket broadcast (injected by server)
        self.on_alert: Optional[Callable[[Alert], Awaitable[None]]] = None

        # Lazy-import alert channels to avoid hard crashes if libs missing
        self._sound_alert = None
        self._push_alert = None
        self._init_channels()

    def _init_channels(self):
        if self._sound_enabled:
            try:
                from alerts.sound_alert import SoundAlert
                self._sound_alert = SoundAlert()
                logger.info("Sound alerts: enabled")
            except Exception as e:
                logger.warning(f"Sound alerts unavailable: {e}")

        if self._push_enabled:
            try:
                from alerts.push_alert import PushAlert
                self._push_alert = PushAlert()
                logger.info("Push alerts: enabled")
            except Exception as e:
                logger.warning(f"Push alerts unavailable: {e}")

    def _is_on_cooldown(self, setup: DetectedSetup) -> bool:
        key = f"{setup.ticker}_{setup.setup_id}_{setup.timeframe}"
        last = self._cooldowns.get(key)
        if last is None:
            return False
        return datetime.utcnow() - last < timedelta(seconds=ALERT_COOLDOWN_SECONDS)

    def _set_cooldown(self, setup: DetectedSetup):
        key = f"{setup.ticker}_{setup.setup_id}_{setup.timeframe}"
        self._cooldowns[key] = datetime.utcnow()

    async def emit(self, setup: DetectedSetup):
        """
        Main entry point called by the scanner for each detected setup.
        """
        if self._is_on_cooldown(setup):
            return

        severity = _determine_severity(setup)
        message = _build_message(setup, severity)

        alert = Alert(
            id=str(uuid.uuid4()),
            ticker=setup.ticker,
            timeframe=setup.timeframe,
            setup_id=setup.setup_id,
            setup_name=setup.setup_name,
            message=message,
            severity=severity,
            entry=setup.entry,
            stop_loss=setup.stop_loss,
            target=setup.target,
            risk_reward=setup.risk_reward,
            htf_confluent=setup.htf_confluent,
            order_block_present=setup.order_block is not None,
        )

        self._alert_history.append(alert)
        self._set_cooldown(setup)

        logger.info(f"ALERT: {message}")

        # Fire all channels concurrently
        tasks = [self._log_alert(alert)]
        if self._sound_alert:
            tasks.append(self._fire_sound(alert))
        if self._push_alert:
            tasks.append(self._fire_push(alert))
        if self.on_alert:
            tasks.append(self.on_alert(alert))

        await asyncio.gather(*tasks, return_exceptions=True)

    async def _log_alert(self, alert: Alert):
        """Always log to console."""
        pass  # already logged above

    async def _fire_sound(self, alert: Alert):
        try:
            await asyncio.to_thread(self._sound_alert.play, alert.severity)
        except Exception as e:
            logger.debug(f"Sound alert error: {e}")

    async def _fire_push(self, alert: Alert):
        try:
            await asyncio.to_thread(
                self._push_alert.notify,
                title=f"QMScan: {alert.ticker} Setup {alert.setup_id}",
                message=f"{alert.setup_name} [{alert.timeframe}] R/R={alert.risk_reward}R",
            )
        except Exception as e:
            logger.debug(f"Push alert error: {e}")

    async def emit_master(self, master):
        """Emit alert for a Master Setup (multi-timeframe confluence)."""
        key = f"MASTER_{master.ticker}"
        last = self._cooldowns.get(key)
        if last and datetime.utcnow() - last < timedelta(seconds=ALERT_COOLDOWN_SECONDS):
            return
        self._cooldowns[key] = datetime.utcnow()
        message = (
            f"[MASTER] {master.ticker} — {master.tf_count} timeframes confluent "
            f"({master.timeframes_str}) score={master.score}"
        )
        logger.info(f"ALERT: {message}")

    def get_history(self, limit: int = 50) -> list[dict]:
        return [a.to_dict() for a in self._alert_history[-limit:]]

    def acknowledge(self, alert_id: str) -> bool:
        for alert in self._alert_history:
            if alert.id == alert_id:
                alert.acknowledged = True
                return True
        return False
