"""Tests for the request limiter and the documentation switch.

The limiter is tested through RequestCounter with a clock the test moves
by hand, so a per minute and a per day limit can both be exercised without
the test waiting for real time to pass.
"""

import pytest

from backend.http_guards import (
    DEFAULT_LIMIT,
    LIMITS,
    RequestCounter,
    api_docs_enabled,
    group_for,
)


class FakeClock:
    """A clock the test moves, standing in for time.monotonic."""

    def __init__(self):
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


def test_requests_are_allowed_up_to_the_limit_then_refused():
    clock = FakeClock()
    counter = RequestCounter(now=clock)

    for _ in range(20):
        assert counter.check("1.2.3.4", "/journeys/route", (20, 250)) is None

    wait = counter.check("1.2.3.4", "/journeys/route", (20, 250))
    assert wait is not None and wait > 0


def test_the_minute_limit_clears_once_the_minute_has_passed():
    clock = FakeClock()
    counter = RequestCounter(now=clock)
    for _ in range(20):
        counter.check("1.2.3.4", "/journeys/route", (20, 250))
    assert counter.check("1.2.3.4", "/journeys/route", (20, 250)) is not None

    clock.advance(61)

    assert counter.check("1.2.3.4", "/journeys/route", (20, 250)) is None


def test_the_daily_limit_still_applies_after_the_minute_clears():
    """The point of the daily limit: spreading requests out must not let
    one caller empty the shared routing allowance."""
    clock = FakeClock()
    counter = RequestCounter(now=clock)

    for _ in range(250):
        assert counter.check("1.2.3.4", "/journeys/route", (20, 250)) is None
        clock.advance(61)  # never trips the per minute limit

    assert counter.check("1.2.3.4", "/journeys/route", (20, 250)) is not None


def test_callers_are_counted_separately():
    clock = FakeClock()
    counter = RequestCounter(now=clock)
    for _ in range(20):
        counter.check("1.2.3.4", "/journeys/route", (20, 250))

    assert counter.check("1.2.3.4", "/journeys/route", (20, 250)) is not None
    assert counter.check("5.6.7.8", "/journeys/route", (20, 250)) is None


def test_paths_are_counted_separately():
    """Using up the route allowance must not stop place search working."""
    clock = FakeClock()
    counter = RequestCounter(now=clock)
    for _ in range(20):
        counter.check("1.2.3.4", "/journeys/route", (20, 250))

    assert counter.check("1.2.3.4", "/journeys/route", (20, 250)) is not None
    assert counter.check("1.2.3.4", "/geocode", (60, 1500)) is None


def test_idle_callers_are_forgotten_so_memory_does_not_grow():
    clock = FakeClock()
    counter = RequestCounter(now=clock)
    for address in range(50):
        counter.check(f"10.0.0.{address}", "/journeys/route", (20, 250))

    clock.advance(25 * 60 * 60)  # more than a day later
    counter.forget_idle_callers()

    assert counter._hits == {}


@pytest.mark.parametrize(
    "path, expected_group",
    [
        ("/journeys/route", "/journeys/route"),
        ("/geocode?query=albury", "/geocode"),
        ("/journeys/rest-plan", "other"),
        ("/journeys/rest-stops/candidates", "other"),
    ],
)
def test_paths_map_to_the_right_limit_group(path, expected_group):
    group, limit = group_for(path)
    assert group == expected_group
    assert limit == LIMITS.get(expected_group, DEFAULT_LIMIT)


def test_the_routing_path_is_limited_more_tightly_than_our_own_database():
    """Routing spends an outside allowance; our own database does not."""
    _, route_limit = group_for("/journeys/route")
    _, own_limit = group_for("/journeys/rest-plan")
    assert route_limit[0] < own_limit[0]
    assert route_limit[1] < own_limit[1]


def test_documentation_is_off_unless_switched_on(monkeypatch):
    monkeypatch.delenv("API_DOCS", raising=False)
    assert api_docs_enabled() is False

    monkeypatch.setenv("API_DOCS", "1")
    assert api_docs_enabled() is True

    monkeypatch.setenv("API_DOCS", "false")
    assert api_docs_enabled() is False


# ---------------------------------------------------------------------
# Added 13 October 2026: a refused request must still carry the CORS
# header (or the website can only say "check your connection"), and
# answers from the route cache must not use up the route limit.
# ---------------------------------------------------------------------

from fastapi import FastAPI, Response  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from backend import http_guards  # noqa: E402
from backend.http_guards import (  # noqa: E402
    CACHE_HIT_HEADER,
    RateLimitMiddleware,
    wait_in_words,
)


@pytest.mark.parametrize(
    "seconds, words",
    [(30, "about a minute"), (61, "about a minute"), (600, "about 10 minutes"), (23512, "about 7 hours")],
)
def test_the_wait_is_said_in_words(seconds, words):
    assert wait_in_words(seconds) == words


def test_a_refund_takes_back_the_latest_request():
    clock = FakeClock()
    counter = RequestCounter(now=clock)
    limit = (2, 2)
    assert counter.check("a", "g", limit) is None
    assert counter.check("a", "g", limit) is None
    counter.refund("a", "g")
    assert counter.check("a", "g", limit) is None
    assert counter.check("a", "g", limit) is not None
    counter.refund("someone else", "g")  # nothing recorded: no error


def test_a_refused_request_still_carries_the_cors_header(monkeypatch):
    """Through the real app, so the middleware order in main.py is what is
    tested. The limit for a made-up path is cut to one request a minute."""
    from backend.main import allowed_origins, app

    monkeypatch.setattr(http_guards, "LIMITS", {"/limit-check": (1, 1)})
    origin = allowed_origins[0]
    client = TestClient(app)
    client.get("/limit-check", headers={"Origin": origin})
    refused = client.get("/limit-check", headers={"Origin": origin})

    assert refused.status_code == 429
    assert refused.headers["access-control-allow-origin"] == origin
    assert "Try again in about a minute" in refused.json()["detail"]


def _route_app() -> FastAPI:
    """A stand-in route endpoint that marks its answer as cached on request."""
    mini = FastAPI()
    mini.add_middleware(RateLimitMiddleware)

    @mini.get("/journeys/route")
    def route(response: Response, cached: bool = False):
        if cached:
            response.headers[CACHE_HIT_HEADER] = "hit"
        return {"ok": True}

    return mini


def test_cached_answers_do_not_use_the_route_limit(monkeypatch):
    monkeypatch.setattr(http_guards, "LIMITS", {"/journeys/route": (2, 2)})
    client = TestClient(_route_app())

    for _ in range(5):
        answer = client.get("/journeys/route", params={"cached": True})
        assert answer.status_code == 200
        assert CACHE_HIT_HEADER not in answer.headers  # never leaves the server

    assert client.get("/journeys/route").status_code == 200
    assert client.get("/journeys/route").status_code == 200
    assert client.get("/journeys/route").status_code == 429


def test_cached_answers_still_count_toward_the_loose_limit(monkeypatch):
    monkeypatch.setattr(http_guards, "LIMITS", {"/journeys/route": (2, 2)})
    monkeypatch.setattr(http_guards, "DEFAULT_LIMIT", (3, 3))
    client = TestClient(_route_app())

    for _ in range(3):
        assert client.get("/journeys/route", params={"cached": True}).status_code == 200
    assert client.get("/journeys/route", params={"cached": True}).status_code == 429
