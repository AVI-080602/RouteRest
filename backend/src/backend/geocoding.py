"""Geocoding helpers for turning user-entered place names into coordinates."""

from typing import TypedDict

import requests

PHOTON_BASE_URL = "https://photon.komoot.io/api"


class CoordinateResult(TypedDict):
    lat: float
    lng: float


class GeocodeResult(TypedDict):
    label: str
    coordinate: CoordinateResult
    # The raw Australian state/territory name from Photon's OSM data, e.g.
    # "Victoria", not a jurisdiction_code, matching this project's own
    # values is left to the caller. None when Photon's result did not
    # include a state (rare, but happens for some rural/POI matches).
    # Used to auto-suggest the Jurisdiction dropdown, see newjourney/page.tsx.
    state: str | None


def _build_location_label(properties: dict) -> str:
    """Create one readable address label from Photon's OSM properties."""
    name_parts = [
        properties.get("name"),
        properties.get("street"),
        properties.get("city"),
        properties.get("state"),
        properties.get("postcode"),
        properties.get("country"),
    ]

    return ", ".join(str(part) for part in name_parts if part)


def search_locations(query: str, limit: int = 5) -> list[GeocodeResult]:
    """Search Australian locations using Photon and return frontend-ready data."""
    response = requests.get(
        PHOTON_BASE_URL,
        params={
            "q": query,
            "limit": limit,
            "countrycode": "AU",
            "lang": "en",
        },
        # Public OSM services can reject anonymous-looking traffic.
        # Identifying the app also makes future rate-limit debugging easier.
        headers={"User-Agent": "RouteRest/0.1 student-project"},
        timeout=10,
    )
    response.raise_for_status()

    results: list[GeocodeResult] = []
    for feature in response.json().get("features", []):
        properties = feature.get("properties", {})
        coordinates = feature.get("geometry", {}).get("coordinates", [])

        if len(coordinates) < 2:
            continue

        # Photon returns GeoJSON coordinates as [longitude, latitude].
        lng, lat = coordinates[0], coordinates[1]
        label = _build_location_label(properties)

        results.append(
            {
                "label": label or properties.get("name", query),
                "coordinate": {
                    "lat": lat,
                    "lng": lng,
                },
                "state": properties.get("state"),
            }
        )

    return results
