"""Tests for the pure, network-free parts of backend.routing.

get_hgv_route itself is not tested here, it makes a real HTTP call to
OpenRouteService, exactly like fatigue_rules.py and geocoding.py's network
calls are not unit tested in this codebase, see their own modules. What
IS worth testing without a network is build_directions_payload, since a
mistake there (in particular the weight unit conversion) would silently
under-restrict routing rather than raising any visible error.
"""

from backend.routing import (
    RouteStep,
    build_directions_payload,
    parse_route_feature,
    parse_route_steps,
)


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


# A trimmed ORS geojson feature in the exact shape the live API returns
# (three waypoints => two segments), with way_points indexing the full
# geometry as ORS does. Small enough to reason about by hand.
ORS_FEATURE = {
    "type": "Feature",
    "properties": {
        "summary": {"distance": 5000.0, "duration": 360.0},
        "segments": [
            {
                "distance": 3000.0,
                "duration": 200.0,
                "steps": [
                    {
                        "distance": 1000.0,
                        "duration": 60.0,
                        "type": 11,
                        "instruction": "Head north on Dean Street",
                        "way_points": [0, 2],
                    },
                    {
                        "distance": 2000.0,
                        "duration": 140.0,
                        "type": 1,
                        "instruction": "Turn right onto Hume Highway",
                        "way_points": [2, 4],
                    },
                ],
            },
            {
                "distance": 2000.0,
                "duration": 160.0,
                "steps": [
                    {
                        "distance": 2000.0,
                        "duration": 150.0,
                        "type": 6,
                        "instruction": "Continue straight",
                        "way_points": [4, 6],
                    },
                    {
                        "distance": 0.0,
                        "duration": 0.0,
                        "type": 10,
                        "instruction": "Arrive at your destination",
                        "way_points": [6, 6],
                    },
                ],
            },
        ],
    },
    "geometry": {
        "type": "LineString",
        "coordinates": [
            [146.91, -36.08],
            [146.92, -36.07],
            [146.93, -36.06],
            [146.95, -36.05],
            [146.97, -36.04],
            [146.99, -36.03],
            [147.01, -36.02],
        ],
    },
}


def test_parse_route_feature_keeps_summary_and_geometry():
    result = parse_route_feature(ORS_FEATURE)
    assert result.distance_km == 5.0
    assert result.duration_hours == 0.1
    assert result.geometry[0] == (146.91, -36.08)
    assert len(result.geometry) == 7


def test_parse_route_steps_flattens_segments_in_order():
    """Steps from every segment come out as one list in driving order,
    with way_points passed through untouched as global geometry indices
    (ORS already numbers them against the whole route)."""
    steps = parse_route_steps(ORS_FEATURE)
    assert [step.instruction for step in steps] == [
        "Head north on Dean Street",
        "Turn right onto Hume Highway",
        "Continue straight",
        "Arrive at your destination",
    ]
    assert steps[0] == RouteStep("Head north on Dean Street", 1000.0, 60.0, 0, 2)
    assert steps[2].start_index == 4 and steps[2].end_index == 6
    # The final step ends on the last geometry vertex.
    assert steps[-1].end_index == len(ORS_FEATURE["geometry"]["coordinates"]) - 1


def test_parse_route_steps_tolerates_missing_or_malformed_steps():
    """Navigation text is a nicety on top of the route; a response without
    usable steps must still yield a route, not an error."""
    summary_only = {"summary": ORS_FEATURE["properties"]["summary"]}
    no_segments = {**ORS_FEATURE, "properties": summary_only}
    assert parse_route_steps(no_segments) == []
    assert parse_route_feature(no_segments).steps == []

    malformed = {
        **ORS_FEATURE,
        "properties": {
            **summary_only,
            "segments": [
                {"steps": [{"instruction": "x", "way_points": "0-2"}, {"instruction": "y"}]}
            ],
        },
    }
    assert parse_route_steps(malformed) == []
