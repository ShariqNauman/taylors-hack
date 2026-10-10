"""
guards.py - CALM / TENSE / FIGHT logic with optional guards. One class shared by live_detector.py and
evaluate_guards.py, so the hold-out test runs exactly the logic the demo runs.

Per scored window (every 0.5 s): smooth the model score; the window is "hot" when the smoothed score
>= FIGHT_AT. A hot window can be blocked by a guard (the names are returned for the overlay):
  ONE_PERSON  fewer than 2 people tracked (single-person rule, always on)
  MIN_TRACK   with min_track: fewer than 2 people tracked for >= features.MIN_TRACK_S
  PROX        with prox_max: the pair never came within prox_max torso lengths in the last 2 s
  TWO_KEY     with two_key: neither a wrist moving toward the other person (>= wrist_toward_min) nor contact
  K_OF_N      with k_of_n = (k, n): fewer than k of the last n windows hot. It blocks the persistence count
              too, so FIGHT then needs ~2 s of hot windows (k=3 of n=4) instead of MIN_DURATION alone
FIGHT starts after MIN_DURATION of unblocked hot windows, is held FIGHT_HOLD, and is never shown with
fewer than 2 people.
"""
from collections import deque
from dataclasses import dataclass

import numpy as np


@dataclass
class Config:
    alpha: float = 0.6
    tense_at: float = 0.5
    fight_at: float = 0.656
    min_duration: float = 1.0
    fight_hold: float = 2.0
    min_track: bool = False
    prox_max: float = None          # torso lengths, None = guard off
    two_key: bool = False
    wrist_toward_min: float = 3.0   # torso lengths / s (same as a "strike" peak in features.py)
    k_of_n: tuple = None            # (k, n), None = guard off


class LevelLogic:
    def __init__(self, cfg: Config):
        self.cfg = cfg
        self.smooth, self.high_since, self.fight_until = 0.0, None, -1.0
        self.recent = deque(maxlen=cfg.k_of_n[1] if cfg.k_of_n else 1)

    def step(self, t: float, raw: float, f: dict):
        """t: window end (s); raw: model score; f: feature dict (with n_people, pair_min_dist, ...).
        Returns (level, smoothed score, list of guards that blocked a hot window)."""
        c = self.cfg
        self.smooth = c.alpha * raw + (1 - c.alpha) * self.smooth
        hot = self.smooth >= c.fight_at
        self.recent.append(hot)
        people = f.get("n_people_1s" if c.min_track else "n_people", 2)
        blocked = []
        if people < 2:
            blocked.append("MIN_TRACK" if c.min_track and f.get("n_people", 0) >= 2 else "ONE_PERSON")
        if c.prox_max is not None and not (f.get("pair_min_dist", np.nan) <= c.prox_max):
            blocked.append("PROX")
        if c.two_key and not (f.get("wrist_toward_speed", np.nan) >= c.wrist_toward_min
                              or f.get("contact_s", 0) > 0):
            blocked.append("TWO_KEY")
        if c.k_of_n and sum(self.recent) < c.k_of_n[0]:
            blocked.append("K_OF_N")
        if hot and not blocked:
            self.high_since = t if self.high_since is None else self.high_since
        else:
            self.high_since = None
        if self.high_since is not None and t - self.high_since >= c.min_duration:
            self.fight_until = t + c.fight_hold
        level = ("FIGHT" if t <= self.fight_until and people >= 2
                 else "TENSE" if self.smooth >= c.tense_at else "CALM")
        return level, self.smooth, (blocked if hot else [])
