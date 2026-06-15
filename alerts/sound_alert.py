"""
alerts/sound_alert.py
System sound alerts using pygame or platform beep as fallback.

Different severity levels play different tones:
  CRITICAL: 3 high-pitched beeps
  HIGH:     2 medium beeps
  MEDIUM:   1 beep
  LOW:      soft click
"""
from __future__ import annotations
import logging
import os
import platform
import time
from core.models import AlertSeverity

logger = logging.getLogger("qmscan.sound")


class SoundAlert:
    def __init__(self):
        self._pygame_ok = False
        self._try_init_pygame()

    def _try_init_pygame(self):
        try:
            import pygame
            pygame.mixer.pre_init(44100, -16, 1, 512)
            pygame.mixer.init()
            self._pygame_ok = True
            logger.info("pygame audio initialized")
        except Exception as e:
            logger.info(f"pygame not available, using system beep: {e}")

    def _generate_beep_array(self, frequency: float, duration: float, volume: float = 0.4):
        """Generate a sine-wave tone as a pygame sound."""
        import pygame
        import numpy as np
        sample_rate = 44100
        n_samples = int(sample_rate * duration)
        t = np.linspace(0, duration, n_samples, False)
        wave = (volume * np.sin(2 * np.pi * frequency * t) * 32767).astype(np.int16)
        sound = pygame.sndarray.make_sound(wave)
        return sound

    def _play_pygame(self, frequency: float, duration: float, count: int = 1, gap: float = 0.1):
        try:
            import pygame
            sound = self._generate_beep_array(frequency, duration)
            for i in range(count):
                sound.play()
                time.sleep(duration + gap)
        except Exception as e:
            logger.debug(f"pygame play error: {e}")
            self._system_beep()

    def _system_beep(self):
        """Fallback: use platform-native beep."""
        system = platform.system()
        try:
            if system == "Windows":
                import winsound
                winsound.Beep(1000, 300)
            elif system == "Darwin":
                os.system("afplay /System/Library/Sounds/Ping.aiff &")
            else:
                print("\a", end="", flush=True)
        except Exception:
            print("\a", end="", flush=True)

    def play(self, severity: AlertSeverity):
        """Play alert sound based on severity."""
        if self._pygame_ok:
            if severity == AlertSeverity.CRITICAL:
                self._play_pygame(frequency=1200, duration=0.15, count=3, gap=0.08)
            elif severity == AlertSeverity.HIGH:
                self._play_pygame(frequency=900, duration=0.2, count=2, gap=0.1)
            elif severity == AlertSeverity.MEDIUM:
                self._play_pygame(frequency=700, duration=0.25, count=1)
            else:  # LOW
                self._play_pygame(frequency=500, duration=0.1, count=1)
        else:
            self._system_beep()
