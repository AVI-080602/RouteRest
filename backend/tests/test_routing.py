"""Tests for the pure, network-free parts of backend.routing.

get_hgv_route itself is not tested here, it makes a real HTTP call to
OpenRouteService, exactly like fatigue_rules.py and geocoding.py's network
calls are not unit tested in this codebase, see their own modules. What
IS worth testing without a network is build_directions_payload, since a
mistake there (in particular the weight unit conversion) would silently
under-restrict routing rather than raising any visible error.
"""

from backend.routing import build_directions_payload


def test_payload_uses_lon_lat_order_not_lat_lon():
    """GeoJSON/ORS expect [longitude, latitude], the opposite order from
    how geocoding.py's GeocodeResult stores coordinates (lat, then lng).
    Getting this backwards would silently route somewhere on the wrong
    side of the world instead of raising an error."""
    payload = build_directions_payload(
        coordinates=[(144.9631, -37.8136), (151.2093, -33.8688)],  # Melbourne, Sydney
        height_m=4.3,
        weight_kg_tonnes=42.5,
    )
    assert payload["coordinates"] == [
        [144.9631, -37.8136],
        [151.2093, -33.8688],
    ]


def test_payload_carries_height_and_weight_restrictions():
    payload = build_directions_payload(
        coordinates=[(144.9631, -37.8136), (151.2093, -33.8688)],
        height_m=4.0,
        weight_kg_tonnes=35.5,
    )
    restrictions = payload["options"]["profile_params"]["restrictions"]
    assert restrictions["height"] == 4.0
    assert restrictions["weight"] == 35.5


def test_payload_sets_hgv_vehicle_type():
    """Without this, ORS would route as a normal car and ignore height/
    weight restrictions entirely, defeating the whole point of this
    module."""
    payload = build_directions_payload(
        coordinates=[(144.9631, -37.8136), (151.2093, -33.8688)],
        height_m=4.3,
        weight_kg_tonnes=42.5,
    )
    assert payload["options"]["vehicle_type"] == "hgv"


def test_payload_supports_multi_stop_waypoints():
    """A journey with intermediate destinations, not just a single
    origin/destination pair, must pass every waypoint through in order,
    ORS builds the route through all of them, not just the first/last."""
    coordinates = [
        (144.9631, -37.8136),  # Melbourne
        (149.13, -35.2809),  # Canberra (intermediate stop)
        (151.2093, -33.8688),  # Sydney
    ]
    payload = build_directions_payload(coordinates, height_m=4.3, weight_kg_tonnes=42.5)
    assert len(payload["coordinates"]) == 3
    assert payload["coordinates"][1] == [149.13, -35.2809]
