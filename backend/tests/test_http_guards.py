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
