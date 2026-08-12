"""Tiny in-memory sliding-window rate limiter (port of flask-limiter usage).

Not distributed-safe (fine for a single box); swap for redis in multi-worker
production if needed.
"""

from __future__ import annotations

import threading
import time

_lock = threading.Lock()
_hits: dict[str, list[float]] = {}


def rate_limit(key: str, max_hits: int, window_seconds: float):
    """Decorator: allow at most `max_hits` calls per `window_seconds` per key.

    key is a callable (request) -> str so it can read the user/ip.
    """

    def deco(view):
        from rest_framework.response import Response

        def wrapper(request, *args, **kwargs):
            k = f"{key(request)}:{view.__name__}"
            now = time.time()
            with _lock:
                bucket = [t for t in _hits.get(k, []) if now - t < window_seconds]
                if len(bucket) >= max_hits:
                    _hits[k] = bucket
                    return Response(
                        {"error": "Rate limit exceeded. Try again shortly."}, status=429
                    )
                bucket.append(now)
                _hits[k] = bucket
            return view(request, *args, **kwargs)

        return wrapper

    return deco
