"""
alerts/push_alert.py
Desktop push notifications via plyer.
Works on Windows, macOS, and Linux (requires libnotify on Linux).
"""
from __future__ import annotations
import logging

logger = logging.getLogger("qmscan.push")


class PushAlert:
    def __init__(self):
        self._plyer_ok = False
        try:
            from plyer import notification
            self._notification = notification
            self._plyer_ok = True
            logger.info("Desktop push notifications: enabled (plyer)")
        except ImportError:
            logger.info("plyer not installed — desktop push notifications disabled")
            logger.info("Install with: pip install plyer")

    def notify(self, title: str, message: str, timeout: int = 8):
        """Send a desktop notification."""
        if not self._plyer_ok:
            return
        try:
            self._notification.notify(
                title=title,
                message=message,
                app_name="QMScan",
                timeout=timeout,
            )
        except Exception as e:
            logger.debug(f"Push notification error: {e}")
