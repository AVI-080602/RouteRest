"""Fetches a real, road-following route for a heavy vehicle.

What this module does: given an ordered list of waypoints (already
geocoded, see geocoding.py) and a vehicle's height/weight, asks
OpenRouteService's HGV-aware directions API for the actual route a truck
can legally drive (avoiding low bridges, weight-restricted roads, etc.),
not just a straight line between the points.

Kept separate from geocoding.py on purpose: geocoding turns place NAMES
into coordinates (Photon, no key needed), this module turns coordinates
into a real DRIVEN ROUTE (OpenRouteService, needs a free API key). They
are two different external services solving two different problems.
"""

import os
from dataclasses import dataclass

import requests

ORS_DIRECTIONS_URL = "https://api.openrouteservice.org/v2/directions/driving-hgv/geojson"

# The conservative routing default already documented on vehicle_model in
# schema.sql (height_m/weight_kg columns): used whenever the frontend does
# not supply real vehicle dimensions, the same fallback the app is
# expected to use when a selected vehicle's own spec is unknown (NULL).
DEFAULT_HEIGHT_M = 4.3
DEFAULT_WEIGHT_KG = 42_500


class RouteNotFoundError(ValueError):
    """Raised when ORS understands the request but cannot find any legal
    HGV route between the given waypoints, e.g. the height/weight
    restrictions rule out every road connecting them. A real, honest
    answer, not a service failure."""


class RoutingUnavailableError(RuntimeError):
    """Raised when the ORS API itself fails, times out, or rejects the
    request (bad/missing key, rate limit), as opposed to RouteNotFoundError
    which means ORS answered but no route exists."""


@dataclass(frozen=True)
class RouteResult:
    """A real driven route: total distance/duration and the road-following
    geometry, ready to draw on a map."""

    distance_km: float
    duration_hours: float
    geometry: list[tuple[float, float]]  # [(lon, lat), ...] in route order


def build_directions_payload(
    coordinates: list[tuple[float, float]],
    height_m: float,
    weight_kg_tonnes: float,
) -> dict:
    """Builds the JSON body for an ORS HGV directions request.

    Kept as a small pure function (no network call) so the payload shape,
    in particular the height/weight unit conversion, gets a real unit
    test without needing a live API key or network access. ORS expects
    coordinates as [longitude, latitude] pairs and restrictions.weight in
    TONNES, not kilograms, a units mismatch here would silently under-
    restrict routing (the truck would be routed over roads too weak for
    its real weight).
    """
    return {
        "coordinates": [[lon, lat] for lon, lat in coordinates],
        "options": {
            "vehicle_type": "hgv",
            "profile_params": {
                "restrictions": {
                    "height": height_m,
                    "weight": weight_kg_tonnes,
                }
            },
        },
    }


def get_hgv_route(
    waypoints: list[tuple[float, float]],
    api_key: str,
    height_m: float = DEFAULT_HEIGHT_M,
    weight_kg: float = DEFAULT_WEIGHT_KG,
) -> RouteResult:
    """Calls OpenRouteService for a real HGV route through the given
    waypoints, in order (first is the departure, last is the final
    destination, anything between is an intermediate stop).

    waypoints are (lon, lat) pairs, matching GeoJSON's coordinate order,
    not (lat, lon), the order geocoding.py's GeocodeResult uses; callers
    must swap when converting one to the other.
    """
    payload = build_directions_payload(waypoints, height_m, weight_kg / 1000)

    try:
        response = requests.post(
            ORS_DIRECTIONS_URL,
            json=payload,
            headers={
                "Authorization": api_key,
                "Content-Type": "application/json",
            },
            timeout=15,
        )
    except requests.RequestException as error:
        raise RoutingUnavailableError(
            f"Could not reach OpenRouteService: {error}"
        ) from error

    if response.status_code == 404:
        # ORS's own signal for "no route exists between these points under
        # the given restrictions", distinct from a service failure.
        raise RouteNotFoundError(
            "No legal HGV route was found between the given waypoints, "
            "the vehicle's height/weight may rule out every connecting road."
        )

    if not response.ok:
        raise RoutingUnavailableError(
            f"OpenRouteService returned {response.status_code}: {response.text}"
        )

    body = response.json()
    features = body.get("features", [])
    if not features:
        raise RouteNotFoundError(
            "OpenRouteService returned no route for the given waypoints."
        )

    route = features[0]
    summary = route["properties"]["summary"]
    geometry_coordinates = route["geometry"]["coordinates"]

    return RouteResult(
        distance_km=summary["distance"] / 1000,
        duration_hours=summary["duration"] / 3600,
        geometry=[(lon, lat) for lon, lat in geometry_coordinates],
    )


def get_api_key() -> str:
    """Reads the ORS API key from the environment, raising a clear error
    if it is missing rather than letting requests fail with an opaque
    401 further down."""
    api_key = os.environ.get("ORS_API_KEY")
    if not api_key:
        raise RoutingUnavailableError(
            "ORS_API_KEY is not set. Get a free key at account.heigit.org "
            "and add it to backend/db/.env (or the deployed backend.env)."
        )
    return api_key
