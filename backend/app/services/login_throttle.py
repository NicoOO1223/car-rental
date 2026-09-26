"""Per-IP limit on failed logins, on top of the per-account lockout.

The account lockout only protects accounts that exist; this also slows an
attacker guessing many emails from one address. State is in process memory:
the app runs as one replica, and with several replicas each would enforce
its own budget, which is still a useful brake, so this is not replaced by a
shared store until it matters.
"""

import threading
import time
from collections import defaultdict, deque

MAX_FAILURES_PER_IP = 30
WINDOW_SECONDS = 15 * 60

_failures: dict[str, deque[float]] = defaultdict(deque)
_lock = threading.Lock()


def _prune(key: str, now: float) -> deque[float]:
    attempts = _failures[key]
    while attempts and now - attempts[0] > WINDOW_SECONDS:
        attempts.popleft()
    return attempts


def is_ip_blocked(ip: str) -> bool:
    with _lock:
        return len(_prune(ip, time.monotonic())) >= MAX_FAILURES_PER_IP


def record_ip_failure(ip: str) -> None:
    with _lock:
        now = time.monotonic()
        _prune(ip, now).append(now)


def reset() -> None:
    """For tests."""
    with _lock:
        _failures.clear()
