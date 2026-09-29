"""Request limiting and security headers for the API.

Why this exists: the security testing on 18 September 2026 found that the
API answers anyone who knows its address, with no limit on how often. Every
route request spends one of the 2,000 truck routes our free allowance gives
us per day, shared by every user, and that allowance has already been
exhausted twice by ordinary testing. A single machine calling at the rate
the service permits would spend a whole day's allowance in under an hour,
which stops route planning working for every driver until it resets.

The limiter is deliberately simple: counts per caller address held in this
process, no extra packages and no shared store. The backend runs as a
single process (see deploy/routerest-backend.service), so one process
counting is the whole picture. If the backend is ever run with several
workers, each would hold its own counts and the effective limit would
multiply, which is the point at which this should move to a shared store.
"""

import os
import time
from collections import defaultdict, deque

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

# Paths that cost us an outside allowance, and what a normal driver needs.
# Planning one journey takes a handful of route calls (the route itself,
# then one per detour when stops are swapped), and place search fires while
# someone types. The limits leave room for that and still stop a machine
# emptying the daily allowance.
LIMITS: dict[str, tuple[int, int]] = {
    # path prefix: (requests per minute, requests per day) for one caller
    "/journeys/route": (20, 250),
    "/geocode": (60, 1500),
}
# Everything else only reads our own database, so it is limited far more
# loosely, purely to stop a runaway client.
DEFAULT_LIMIT = (120, 10_000)

MINUTE = 60.0
DAY = 24 * 60 * 60.0

# A caller with no traffic for this long is forgotten, so the counts do not
# grow without bound on a long running server.
FORGET_AFTER = DAY


class RequestCounter:
    """Counts recent requests per caller, per path group.

    Kept separate from the middleware so it can be tested with a clock
    that does not involve waiting for real minutes to pass.
    """

    def __init__(self, now=time.monotonic):
        self._now = now
        self._hits: dict[tuple[str, str], deque[float]] = defaultdict(deque)

    def _prune(self, hits: deque[float], now: float) -> None:
        while hits and now - hits[0] > DAY:
            hits.popleft()

    def check(self, caller: str, group: str, limit: tuple[int, int]) -> int | None:
        """Records one request and returns None when it is allowed, or the
        number of seconds to wait when the caller is over a limit."""
        per_minute, per_day = limit
        now = self._now()
        hits = self._hits[(caller, group)]
        self._prune(hits, now)

        in_last_minute = sum(1 for moment in hits if now - moment <= MINUTE)
        if in_last_minute >= per_minute:
            oldest_in_minute = next(moment for moment in hits if now - moment <= MINUTE)
            return max(1, int(MINUTE - (now - oldest_in_minute)) + 1)

        if len(hits) >= per_day:
            return max(1, int(DAY - (now - hits[0])) + 1)

        hits.append(now)
        return None

    def forget_idle_callers(self) -> None:
        """Drops callers with nothing recorded in the last day."""
        now = self._now()
        for key, hits in list(self._hits.items()):
            self._prune(hits, now)
            if not hits:
                del self._hits[key]


def group_for(path: str) -> tuple[str, tuple[int, int]]:
    """The limit group a path belongs to, and that group's limits."""
    for prefix, limit in LIMITS.items():
        if path.startswith(prefix):
            return prefix, limit
    return "other", DEFAULT_LIMIT


def caller_address(request: Request) -> str:
    """The caller's address. Behind our web server the real address is in
    X-Forwarded-For; the first entry is the original client."""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Refuses requests from a caller that is asking too often."""

    def __init__(self, app, counter: RequestCounter | None = None):
        super().__init__(app)
        self._counter = counter or RequestCounter()
        self._requests_since_cleanup = 0

    async def dispatch(self, request: Request, call_next):
        # A browser's permission check costs us nothing and must not be
        # refused, or the real request never follows.
        if request.method == "OPTIONS":
            return await call_next(request)

        group, limit = group_for(request.url.path)
        wait_seconds = self._counter.check(caller_address(request), group, limit)

        self._requests_since_cleanup += 1
        if self._requests_since_cleanup >= 1000:
            self._counter.forget_idle_callers()
            self._requests_since_cleanup = 0

        if wait_seconds is not None:
            return JSONResponse(
                status_code=429,
                content={
                    "detail": (
                        "Too many requests from this address. This service shares a "
                        "daily allowance with every driver using RouteRest, so it "
                        "limits how often one caller may ask. Try again shortly."
                    )
                },
                headers={"Retry-After": str(wait_seconds)},
            )

        return await call_next(request)


# Sent on every response. The API returns JSON to our own website, so the
# content policy can refuse everything: there is nothing legitimate for a
# browser to load from these responses.
SECURITY_HEADERS = {
    "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
}


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Adds the standard protective headers, which the security testing
    found missing on both hosts."""

    async def dispatch(self, request: Request, call_next) -> Response:
        response = await call_next(request)
        for name, value in SECURITY_HEADERS.items():
            response.headers.setdefault(name, value)
        return response


def api_docs_enabled() -> bool:
    """Whether to publish the interactive API documentation.

    It describes every request and field, which is useful while developing
    and an invitation on a public server, so it is off unless API_DOCS is
    set. Local development sets it in backend/db/.env; the deployed service
    does not set it at all.
    """
    return os.environ.get("API_DOCS", "").strip().lower() in {"1", "true", "yes", "on"}
