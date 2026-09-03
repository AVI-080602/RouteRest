"""Matches each planned rest break to a real, nearby rest area.

What this module does: given the real route geometry (from routing.py's
ORS call) and how far along that route (as a fraction of total driving
distance) a break falls, finds an actual rest area from the rest_area
table near that point, instead of the frontend's old hardcoded 2-location
mock cycling.

Two distinct approximations here, both worth being honest about, not
hidden:
  1. "Fraction of driving TIME equals fraction of route DISTANCE" assumes
     roughly uniform average speed along the whole route. Real trips vary
     (highway vs. town driving), so the matched stop is an approximation
     of where the driver will actually be, not a precise prediction.
  2. interpolate_point_along_route measures distance between route
     points with a simple haversine formula, not true road distance. For
     the purpose of "roughly where is this break along the route", that
     is precise enough; it is NOT used for anything distance-critical
     like the fatigue calculation itself (that stays exact, driven by
     rest_plan.py's minute-by-minute simulation, not this module).
"""

import math
from dataclasses import dataclass

import psycopg

EARTH_RADIUS_KM = 6371.0


def _haversine_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    """Great-circle distance in km between two (lon, lat) points."""
    lon1, lat1 = a
    lon2, lat2 = b
    lat1_rad, lat2_rad = math.radians(lat1), math.radians(lat2)
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    h = (
        math.sin(dlat / 2) ** 2
        + math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(dlon / 2) ** 2
    )
    return 2 * EARTH_RADIUS_KM * math.asin(math.sqrt(min(1.0, h)))


def interpolate_point_along_route(
    geometry: list[tuple[float, float]], fraction: float
) -> tuple[float, float]:
    """Finds the (lon, lat) point a given fraction (0..1) of the way
    along a route's total length, walking the route's coordinate list
    and accumulating segment distances until the target is reached.

    A pure function (no network, no database), kept separate from
    find_nearest_rest_area so the interpolation math gets a real unit
    test without needing a live database.
    """
    if not geometry:
        raise ValueError("geometry must not be empty")
    if len(geometry) == 1 or fraction <= 0:
        return geometry[0]
    if fraction >= 1:
        return geometry[-1]

    segment_lengths = [
        _haversine_km(geometry[i], geometry[i + 1]) for i in range(len(geometry) - 1)
    ]
    total_length = sum(segment_lengths)
    if total_length == 0:
        return geometry[0]

    target_distance = fraction * total_length
    covered = 0.0
    for i, segment_length in enumerate(segment_lengths):
        if covered + segment_length >= target_distance or i == len(segment_lengths) - 1:
            remaining = target_distance - covered
            t = remaining / segment_length if segment_length > 0 else 0.0
            lon1, lat1 = geometry[i]
            lon2, lat2 = geometry[i + 1]
            return (lon1 + (lon2 - lon1) * t, lat1 + (lat2 - lat1) * t)
        covered += segment_length

    return geometry[-1]


# Maps rest_area's individual boolean facility columns to the plain
# labels the frontend already displays (matching the wording the mock
# data used, so no frontend rendering change is needed). Only ever
# applied when a column is TRUE; NULL ("not published for this state",
# see schema.sql) and FALSE ("confirmed absent") are both just omitted
# from the list, this is a display simplification, not a claim that
# NULL means absent, that distinction still matters for anything reading
# the raw rest_area table directly.
_FACILITY_LABELS: list[tuple[str, str]] = [
    ("toilet", "Toilets"),
    ("disabled_toilet", "Accessible toilet"),
    ("lighting", "Lighting"),
    ("shelter", "Shelter"),
    ("water", "Water"),
    ("bin", "Bin"),
    ("table_or_chair", "Seating"),
    ("bbq", "BBQ"),
    ("shade", "Shade"),
    ("power", "Power"),
    ("has_fuel_derived", "Fuel"),
]


@dataclass(frozen=True)
class MatchedRestStop:
    name: str
    road_name: str | None
    lat: float
    lng: float
    distance_km: float
    facilities: list[str]


def find_nearest_rest_area(
    conn: psycopg.Connection,
    lon: float,
    lat: float,
    radius_km: float = 50,
) -> MatchedRestStop | None:
    """Finds the closest real heavy-vehicle rest area to a point, within
    radius_km. Returns None (not an error) when nothing is that close,
    a genuinely correct answer for remote stretches of route, not a
    failure.

    Uses the same idx_rest_area_location GIST index schema.sql built for
    exactly this kind of nearest-neighbour query, via the `<->` KNN
    operator, so this stays fast even against all 5,036 rows.
    """
    with conn.cursor() as cursor:
        cursor.execute(
            """
            SELECT
                name, road_name,
                ST_Y(location::geometry) AS lat,
                ST_X(location::geometry) AS lng,
                ST_Distance(
                    location,
                    ST_SetSRID(ST_MakePoint(%(lon)s, %(lat)s), 4326)::geography
                ) / 1000 AS distance_km,
                toilet, disabled_toilet, lighting, shelter, water, bin,
                table_or_chair, bbq, shade, power, has_fuel_derived
            FROM rest_area
            WHERE heavy_vehicle_area = TRUE
              AND ST_DWithin(
                    location,
                    ST_SetSRID(ST_MakePoint(%(lon)s, %(lat)s), 4326)::geography,
                    %(radius_m)s
                  )
            ORDER BY location <-> ST_SetSRID(ST_MakePoint(%(lon)s, %(lat)s), 4326)::geography
            LIMIT 1
            """,
            {"lon": lon, "lat": lat, "radius_m": radius_km * 1000},
        )
        row = cursor.fetchone()

    if row is None:
        return None

    name, road_name, result_lat, result_lng, distance_km, *facility_flags = row
    facilities = [
        label
        for (_, label), is_true in zip(_FACILITY_LABELS, facility_flags)
        if is_true is True
    ]

    return MatchedRestStop(
        name=name or "Unnamed rest area",
        road_name=road_name,
        lat=result_lat,
        lng=result_lng,
        distance_km=distance_km,
        facilities=facilities,
    )
