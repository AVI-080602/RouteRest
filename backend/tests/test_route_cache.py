"""Tests for the route cache key.

The database side is not unit tested here, the same way fatigue_rules.py's
queries are not: it needs a real database. What matters and can be tested
without one is the key, because a key that is too loose hands a driver a
route their truck cannot legally use, and a key that is too strict caches
nothing and the allowance keeps being spent.
"""

from backend.route_cache import COORDINATE_PLACES, MAX_AGE, cache_key

MELBOURNE_TO_SYDNEY = [(144.9631, -37.8136), (151.2093, -33.8688)]


def test_the_same_journey_and_truck_produce_the_same_key():
    first = cache_key(MELBOURNE_TO_SYDNEY, height_m=4.3, weight_kg=42_500)
    second = cache_key(MELBOURNE_TO_SYDNEY, height_m=4.3, weight_kg=42_500)
    assert first == second


def test_a_taller_truck_does_not_reuse_a_shorter_truck_s_route():
    """Height changes which roads are legal, so the routes must not be
    shared: a low bridge is exactly the thing this product exists to avoid."""
    low = cache_key(MELBOURNE_TO_SYDNEY, height_m=4.0, weight_kg=42_500)
    high = cache_key(MELBOURNE_TO_SYDNEY, height_m=4.6, weight_kg=42_500)
    assert low != high


def test_a_heavier_truck_does_not_reuse_a_lighter_truck_s_route():
    light = cache_key(MELBOURNE_TO_SYDNEY, height_m=4.3, weight_kg=20_000)
    heavy = cache_key(MELBOURNE_TO_SYDNEY, height_m=4.3, weight_kg=42_500)
    assert light != heavy


def test_a_different_destination_produces_a_different_key():
    to_sydney = cache_key(MELBOURNE_TO_SYDNEY, height_m=4.3, weight_kg=42_500)
    to_adelaide = cache_key(
        [(144.9631, -37.8136), (138.6007, -34.9285)], height_m=4.3, weight_kg=42_500
    )
    assert to_sydney != to_adelaide


def test_visiting_the_same_places_in_a_different_order_is_a_different_route():
    there = cache_key(MELBOURNE_TO_SYDNEY, height_m=4.3, weight_kg=42_500)
    back = cache_key(list(reversed(MELBOURNE_TO_SYDNEY)), height_m=4.3, weight_kg=42_500)
    assert there != back


def test_a_coordinate_difference_too_small_to_matter_still_matches():
    """About a metre apart. Rounding these together is what makes the
    cache useful: the same journey planned twice rarely produces byte
    identical coordinates."""
    nudged = [(144.96310001, -37.81360002), (151.20930003, -33.86880001)]
    assert cache_key(MELBOURNE_TO_SYDNEY, 4.3, 42_500) == cache_key(nudged, 4.3, 42_500)


def test_a_coordinate_difference_that_does_matter_is_a_different_route():
    """Roughly 100 m away, which can be a different side of a divided road."""
    moved = [(144.9641, -37.8146), (151.2093, -33.8688)]
    assert cache_key(MELBOURNE_TO_SYDNEY, 4.3, 42_500) != cache_key(moved, 4.3, 42_500)


def test_the_key_reveals_nothing_about_where_the_journey_goes():
    """The key is stored in the database, so it must not be readable as a
    list of destinations."""
    key = cache_key(MELBOURNE_TO_SYDNEY, height_m=4.3, weight_kg=42_500)
    assert len(key) == 64
    assert all(character in "0123456789abcdef" for character in key)
    for coordinate in ("144.96", "-37.81", "151.20", "-33.86"):
        assert coordinate not in key


def test_entries_expire_so_road_changes_are_picked_up():
    assert 1 <= MAX_AGE.days <= 90


def test_coordinates_are_rounded_finer_than_anything_that_changes_a_route():
    """Five places is about a metre. Fewer would start merging genuinely
    different pickup points."""
    assert COORDINATE_PLACES >= 5
