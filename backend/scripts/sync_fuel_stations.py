"""Pulls every fuel station in Australia from OpenStreetMap and loads it
into the local fuel_station table.

What this script does, step by step: creates the fuel_station table if it
is missing (backend/db/fuel_station.sql), asks the public Overpass API
for every amenity=fuel in Australia (about 7,600, a 2.6 MB answer), writes
them with an upsert, and removes stations that are no longer in
OpenStreetMap. Everything happens in one transaction, so a failure part
way leaves the previous data in place.

Run it on first setup and before each release, like sync_rest_areas.py.
It reads only public data; no driver data is involved.

Usage:
    uv run python scripts/sync_fuel_stations.py

Database connection: the same POSTGRES_* environment variables as the
backend (or backend/db/.env, as sync_rest_areas.py uses).
"""

import os
import sys
from pathlib import Path

import psycopg
import requests
from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))
from backend.fuel_stations import osm_yes_no  # noqa: E402

# Public Overpass servers, tried in order. Both carry the full planet.
OVERPASS_URLS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]
# Every fuel station inside Australia's national boundary, mapped as a
# point or as an area (a forecourt or building), areas reduced to their
# centre point.
OVERPASS_QUERY = """
[out:json][timeout:180];
area["ISO3166-1"="AU"][admin_level=2]->.au;
(
  node["amenity"="fuel"](area.au);
  way["amenity"="fuel"](area.au);
);
out center tags;
"""
# Overpass asks every client to identify itself.
USER_AGENT = "RouteRest/1.0 (student truck rest planner; data sync)"

SCHEMA_FILE = Path(__file__).resolve().parent.parent / "db" / "fuel_station.sql"


def fetch_fuel_stations():
    """Asks each Overpass server in turn; returns the list of elements."""
    last_error = None
    for url in OVERPASS_URLS:
        try:
            response = requests.post(
                url,
                data={"data": OVERPASS_QUERY},
                headers={"User-Agent": USER_AGENT},
                timeout=300,
            )
            response.raise_for_status()
            return response.json()["elements"]
        except (requests.RequestException, ValueError, KeyError) as error:
            print(f"  {url} failed: {error}")
            last_error = error
    raise RuntimeError(f"No Overpass server answered: {last_error}")


def to_row(element, source_file_id):
    """One Overpass element as a fuel_station row, or None if it has no
    position (which Overpass should never send, but a row without one
    could not be searched)."""
    tags = element.get("tags", {})
    if "lat" in element:
        lat, lon = element["lat"], element["lon"]
    elif "center" in element:
        lat, lon = element["center"]["lat"], element["center"]["lon"]
    else:
        return None
    return {
        "osm_id": f"{element['type']}/{element['id']}",
        "name": tags.get("name"),
        "brand": tags.get("brand"),
        "operator": tags.get("operator"),
        "lon": lon,
        "lat": lat,
        "diesel": osm_yes_no(tags.get("fuel:diesel")),
        "truck_diesel": osm_yes_no(tags.get("fuel:HGV_diesel")),
        "truck_access": osm_yes_no(tags.get("hgv")),
        "opening_hours": tags.get("opening_hours"),
        "source_file_id": source_file_id,
    }


def main():
    env_path = Path(__file__).resolve().parent.parent / "db" / ".env"
    load_dotenv(env_path)

    print("Fetching fuel stations in Australia from OpenStreetMap (Overpass)...")
    elements = fetch_fuel_stations()
    print(f"Received {len(elements)} stations.")

    conn = psycopg.connect(
        host=os.environ.get("POSTGRES_HOST", "localhost"),
        port=os.environ.get("POSTGRES_PORT", "5432"),
        dbname=os.environ.get("POSTGRES_DB", "routerest"),
        user=os.environ.get("POSTGRES_USER", "postgres"),
        password=os.environ["POSTGRES_PASSWORD"],
    )
    try:
        with conn.cursor() as cursor:
            cursor.execute(SCHEMA_FILE.read_text(encoding="utf-8"))
            cursor.execute(
                """
                INSERT INTO source_file (source_name, publisher, licence, url, retrieved_at, notes)
                VALUES (%s, %s, %s, %s, now(), %s)
                RETURNING id
                """,
                (
                    "OpenStreetMap fuel stations (Australia)",
                    "OpenStreetMap contributors",
                    "ODbL 1.0",
                    "https://www.openstreetmap.org/copyright",
                    "amenity=fuel inside Australia via the Overpass API. Truck access, diesel and opening hours are as mapped; most stations do not map truck access.",
                ),
            )
            source_file_id = cursor.fetchone()[0]
            cursor.execute("SELECT now()")
            sync_started = cursor.fetchone()[0]

            rows = [r for r in (to_row(e, source_file_id) for e in elements) if r]
            cursor.executemany(
                """
                INSERT INTO fuel_station (
                    osm_id, name, brand, operator, location, diesel,
                    truck_diesel, truck_access, opening_hours,
                    source_file_id, last_synced_at
                ) VALUES (
                    %(osm_id)s, %(name)s, %(brand)s, %(operator)s,
                    ST_SetSRID(ST_MakePoint(%(lon)s, %(lat)s), 4326)::geography,
                    %(diesel)s, %(truck_diesel)s, %(truck_access)s,
                    %(opening_hours)s, %(source_file_id)s, now()
                )
                ON CONFLICT (osm_id) DO UPDATE SET
                    name = EXCLUDED.name,
                    brand = EXCLUDED.brand,
                    operator = EXCLUDED.operator,
                    location = EXCLUDED.location,
                    diesel = EXCLUDED.diesel,
                    truck_diesel = EXCLUDED.truck_diesel,
                    truck_access = EXCLUDED.truck_access,
                    opening_hours = EXCLUDED.opening_hours,
                    source_file_id = EXCLUDED.source_file_id,
                    last_synced_at = now()
                """,
                rows,
            )
            # Stations deleted from OpenStreetMap since the last sync.
            cursor.execute(
                "DELETE FROM fuel_station WHERE last_synced_at < %s", (sync_started,)
            )
            removed = cursor.rowcount
        conn.commit()
    finally:
        conn.close()

    print(f"Synced {len(rows)} fuel stations; removed {removed} no longer mapped.")


if __name__ == "__main__":
    main()
