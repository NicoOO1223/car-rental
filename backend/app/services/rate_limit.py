"""A fixed-window limit on how often one client address may do something.

The public storefront is open to anyone, so every endpoint there is limited per
address. State is in process memory: with several replicas each enforces its own
budget, which is still a useful brake. Anything that must hold across restarts
(how many unpaid holds one address may have) is counted in the database instead.
"""

import threading
import time
from collections import defaultdict, deque

from fastapi import Request

from app.errors import AppError
from app.services.client_ip import client_ip

_hits: dict[tuple[str, str], deque[float]] = defaultdict(deque)
_lock = threading.Lock()


def hit(bucket: str, key: str, limit: int, window_seconds: int) -> int | None:
    """
    Counts one use of `bucket` by `key`. Returns None when it is allowed, or how
    many seconds to wait when the limit has been reached (the use is not counted).
    """

    now = time.monotonic()

    with _lock:
        recent = _hits[(bucket, key)]

        while recent and now - recent[0] > window_seconds:
            recent.popleft()

        if len(recent) >= limit:
            return max(1, int(window_seconds - (now - recent[0])) + 1)

        recent.append(now)

        return None


def limit_by_ip(bucket: str, limit: int, window_seconds: int = 60):
    """A FastAPI dependency: at most `limit` calls per address per window."""

    def dependency(request: Request) -> None:
        wait = hit(bucket, client_ip(request), limit, window_seconds)

        if wait is not None:
            raise AppError(
                "public.rate_limited",
                "Too many requests. Please try again in a moment.",
                status_code=429,
                headers={"Retry-After": str(wait)},
                seconds=wait,
            )

    return dependency


def reset() -> None:
    """For tests."""
    with _lock:
        _hits.clear()
