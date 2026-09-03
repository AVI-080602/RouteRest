"""Tests for the pure, network-free parts of backend.rest_stops.

find_nearest_rest_area itself is not tested here, it needs a real
database connection, same reasoning as fatigue_rules.py/geocoding.py's
network/DB calls not being unit tested in this codebase. What IS worth
testing without a database is interpolate_point_along_route, since a
mistake there would silently match every break to the wrong point along
the route without any visible error.
"""

from backend.rest_stops import _display_name, interpolate_point_along_route

# A simple three-point route: Melbourne -> a midpoint -> Sydney-ish,
# roughly a straight line for easy hand-checking.
STRAIGHT_ROUTE = [
    (144.0, -38.0),
    (147.0, -36.0),
    (150.0, -34.0),
]


def test_fraction_zero_returns_the_start():
    assert interpolate_point_along_route(STRAIGHT_ROUTE, 0.0) == STRAIGHT_ROUTE[0]


def test_fraction_one_returns_the_end():
    assert interpolate_point_along_route(STRAIGHT_ROUTE, 1.0) == STRAIGHT_ROUTE[-1]


def test_fraction_beyond_one_clamps_to_the_end():
    """A break computed as slightly past the route's total driving time
    (rounding, or the last leg of the journey) should land on the final
    point, not raise or extrapolate past it."""
    assert interpolate_point_along_route(STRAIGHT_ROUTE, 1.5) == STRAIGHT_ROUTE[-1]


def test_fraction_below_zero_clamps_to_the_start():
    assert interpolate_point_along_route(STRAIGHT_ROUTE, -0.2) == STRAIGHT_ROUTE[0]


def test_midpoint_fraction_lands_between_the_bracketing_points():
    """Not asserting exact coordinates (haversine interpolation isn't
    perfectly linear in lon/lat), just that the result sits within the
    route's bounding box and roughly where a straight-line route's
    midpoint should be, both longitude and latitude between the first
    and last point."""
    lon, lat = interpolate_point_along_route(STRAIGHT_ROUTE, 0.5)
    assert STRAIGHT_ROUTE[0][0] < lon < STRAIGHT_ROUTE[-1][0]
    assert STRAIGHT_ROUTE[0][1] < lat < STRAIGHT_ROUTE[-1][1]


def test_single_point_route_returns_that_point_regardless_of_fraction():
    single = [(144.9631, -37.8136)]
    assert interpolate_point_along_route(single, 0.7) == single[0]


def test_a_two_point_route_interpolates_linearly():
    """With only one segment, the interpolated point must be exactly on
    the straight line between the two points, this is checkable exactly
    (unlike the multi-segment case above), a real regression check for
    the interpolation math itself."""
    route = [(144.0, -38.0), (150.0, -34.0)]
    lon, lat = interpolate_point_along_route(route, 0.5)
    assert lon == 147.0
    assert lat == -36.0


def test_display_name_prefers_the_real_name():
    assert _display_name("Gordon VC Rest Area", "Hume Highway") == "Gordon VC Rest Area"


def test_display_name_falls_back_to_road_name():
    """NSW/NT have a real name for nearly every row, but QLD/SA have
    none at all and VIC/WA/TAS are mostly missing it too (see the state
    breakdown that found this), road_name is still real source data in
    that case, a better fallback than a bare placeholder."""
    assert _display_name(None, "Bruce Highway") == "Rest area on Bruce Highway"


def test_display_name_falls_back_to_a_placeholder_when_both_are_missing():
    """QLD and SA rows have neither name nor road_name at all, nothing
    honest to show but a generic placeholder."""
    assert _display_name(None, None) == "Unnamed rest area"
