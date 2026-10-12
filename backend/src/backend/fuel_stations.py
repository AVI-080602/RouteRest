"""Finds real fuel stations near a point, from the fuel_station table.

What this module does: answers "where is the nearest fuel?" for the
navigation screen (Rory's "find fuel", AC 5.1.6). The table is a local
copy of OpenStreetMap's fuel stations (see backend/db/fuel_station.sql and
scripts/sync_fuel_stations.py), so a search never leaves our server.

Two things the data cannot tell us, and the answers say so rather than
guess: whether a truck can actually get in (only a handful of stations
are tagged for heavy vehicles), and whether a station is open right now
(opening hours are passed through as mapped, not interpreted). The
frontend prefers stations tagged for trucks or diesel; this module just
returns the nearest ones with their tags.
"""

from dataclasses import dataclass

import psycopg


@dataclass(frozen=True)
class NearbyFuelStation:
    name: str
    brand: str | None
    lat: float
    lng: float
    distance_km: float
    diesel: bool | None
    truck_diesel: bool | None
    truck_access: bool | None
    opening_hours: str | None


def display_name(name: str | None, brand: str | None, operator: str | None) -> str:
    """What to call a station out loud. Many are mapped with only a brand
    ("BP") or an operator, a few with nothing, so this falls back in that
    order. Pure, so it is unit tested without a database."""
    for value in (name, brand, operator):
        if value and value.strip():
            return value.strip()
    return "Fuel station"


def osm_yes_no(value: str | None) -> bool | None:
    """An OpenStreetMap yes/no tag as True, False or None (not mapped).
    "designated" counts as yes: a station built for trucks. Anything else
    ("limited", "customers", a typo) is treated as not mapped rather than
    guessed either way."""
    if value is None:
        return None
    value = value.strip().lower()
    if value in ("yes", "designated"):
        return True
    if value == "no":
        return False
    return None


def find_nearby_fuel_stations(
    conn: psycopg.Connection,
    lon: float,
    lat: float,
    radius_km: float = 50,
    limit: int = 10,
) -> list[NearbyFuelStation]:
    """Up to `limit` fuel stations within radius_km of a point, nearest
    first. Stations mapped as closed to trucks (hgv=no) are left out. An
    empty list is a correct answer in the outback, not an error.

    Straight-line distance, not road distance: the frontend asks the
    routing service for the real distance to the one it picks."""
    with conn.cursor() as cursor:
        cursor.execute(
            """
            SELECT
                name, brand, operator,
                ST_Y(location::geometry) AS lat,
                ST_X(location::geometry) AS lng,
                ST_Distance(
                    location,
                    ST_SetSRID(ST_MakePoint(%(lon)s, %(lat)s), 4326)::geography
                ) / 1000 AS distance_km,
                diesel, truck_diesel, truck_access, opening_hours
            FROM fuel_station
            WHERE truck_access IS DISTINCT FROM FALSE
              AND ST_DWithin(
                    location,
                    ST_SetSRID(ST_MakePoint(%(lon)s, %(lat)s), 4326)::geography,
                    %(radius_m)s
                  )
            ORDER BY location <-> ST_SetSRID(ST_MakePoint(%(lon)s, %(lat)s), 4326)::geography
            LIMIT %(limit)s
            """,
            {"lon": lon, "lat": lat, "radius_m": radius_km * 1000, "limit": limit},
        )
        rows = cursor.fetchall()

    return [
        NearbyFuelStation(
            name=display_name(name, brand, operator),
            brand=brand,
            lat=row_lat,
            lng=row_lng,
            distance_km=distance_km,
            diesel=diesel,
            truck_diesel=truck_diesel,
            truck_access=truck_access,
            opening_hours=opening_hours,
        )
        for (
            name,
            brand,
            operator,
            row_lat,
            row_lng,
            distance_km,
            diesel,
            truck_diesel,
            truck_access,
            opening_hours,
        ) in rows
    ]
