"""Pulls the National Formal Rest Areas dataset from the NFDH API and loads
it into the local rest_area table.

What this script does, step by step: fetches every rest area record from
the government's live ArcGIS API (no key required), converts each record's
fields into the shapes our database expects, and writes them into Postgres
with an upsert, so re-running this script updates existing rows instead of
duplicating them. Run it whenever the cached data needs refreshing.

Usage:
    uv run python scripts/sync_rest_areas.py

Requires a .env file in backend/db/ with the database connection details
(see backend/db/.env.example).
"""

import os
from pathlib import Path

import psycopg
import requests
from dotenv import load_dotenv

# The live NFDH endpoint, verified working with no API key. outSR=4326
# forces WGS84 coordinates (the source defaults to Web Mercator, which
# would silently place every point at the wrong location if we didn't ask
# for this explicitly, see the note in schema.sql). resultType=standard
# raises the page size past the default 2000-row cap so one request
# returns the whole dataset instead of silently truncating it.
NFDH_URL = (
    "https://spatial.infrastructure.gov.au/server/rest/services/Hosted/"
    "RADAR_Curated_Prod_restareas/FeatureServer/1/query"
)
NFDH_PARAMS = {
    "where": "1=1",  # every record, not filtered to one state or to heavy_vehicle_area only; the app filters at query time using the stored flags
    "outFields": "*",
    "outSR": 4326,
    "resultType": "standard",
    "f": "geojson",
}

# Facility fields the source reports as the text "Y" / "N", or leaves
# missing when a state simply never published that field. We convert "Y"
# to True and "N" to False, but a missing value stays None (not False),
# preserving the "not published" vs "confirmed absent" distinction the
# rest_area table is designed around.
FACILITY_FIELDS = [
    "toilet", "disabled_toilet", "lighting", "shelter", "water",
    "bin", "table_or_chair", "bbq", "shade", "power",
]


def yn_to_bool(value):
    """Converts the source's 'Y'/'N' text into True/False, or None if absent."""
    if value == "Y":
        return True
    if value == "N":
        return False
    return None


def derive_has_fuel(provider_type):
    """Guesses whether fuel is available. NFDH has no real fuel field, so
    this is an inference from the provider type text, not a fact, matching
    the has_fuel_derived comment in schema.sql."""
    if not provider_type:
        return False
    return "SERVICE CENTRE" in provider_type.upper()


def fetch_rest_areas():
    """Calls the live NFDH API once and returns the list of GeoJSON features."""
    response = requests.get(NFDH_URL, params=NFDH_PARAMS, timeout=60)
    response.raise_for_status()  # fail loudly rather than silently loading a partial/error response
    return response.json()["features"]


def ensure_source_file(cursor):
    """Inserts (or reuses) the source_file row this sync's data points back to,
    so every rest_area row can be traced to where it came from."""
    cursor.execute(
        """
        INSERT INTO source_file (source_name, publisher, licence, url, retrieved_at, notes)
        VALUES (%s, %s, %s, %s, now(), %s)
        RETURNING id
        """,
        (
            "NFDH National Formal Rest Areas",
            "Department of Infrastructure, Transport, Regional Development, Communications, Sport and the Arts",
            None,  # licence not specified on the catalogue entry; recorded as a project assumption elsewhere
            "https://spatial.infrastructure.gov.au/server/rest/services/Hosted/RADAR_Curated_Prod_restareas/FeatureServer/1",
            "Licence not specified on the catalogue entry; used with attribution as a documented assumption. No fuel/food/shower fields exist in this source; has_fuel_derived is an inference, not a fact.",
        ),
    )
    return cursor.fetchone()[0]


def upsert_rest_area(cursor, feature, source_file_id):
    """Writes one rest area record into the database, updating it in place
    if that radar_id already exists (so re-running this script refreshes
    the cache instead of creating duplicates)."""
    props = feature["properties"]
    lon, lat = feature["geometry"]["coordinates"]

    cursor.execute(
        """
        INSERT INTO rest_area (
            radar_id, name, road_name, locality, state, location,
            heavy_vehicle_area, toilet, disabled_toilet, lighting, shelter,
            water, bin, table_or_chair, bbq, shade, power, provider_type,
            has_fuel_derived, comments, source_file_id, last_synced_at
        ) VALUES (
            %(radar_id)s, %(name)s, %(road_name)s, %(locality)s, %(state)s,
            ST_SetSRID(ST_MakePoint(%(lon)s, %(lat)s), 4326)::geography,
            %(heavy_vehicle_area)s, %(toilet)s, %(disabled_toilet)s, %(lighting)s,
            %(shelter)s, %(water)s, %(bin)s, %(table_or_chair)s, %(bbq)s,
            %(shade)s, %(power)s, %(provider_type)s, %(has_fuel_derived)s,
            %(comments)s, %(source_file_id)s, now()
        )
        ON CONFLICT (radar_id) DO UPDATE SET
            name = EXCLUDED.name,
            road_name = EXCLUDED.road_name,
            locality = EXCLUDED.locality,
            state = EXCLUDED.state,
            location = EXCLUDED.location,
            heavy_vehicle_area = EXCLUDED.heavy_vehicle_area,
            toilet = EXCLUDED.toilet,
            disabled_toilet = EXCLUDED.disabled_toilet,
            lighting = EXCLUDED.lighting,
            shelter = EXCLUDED.shelter,
            water = EXCLUDED.water,
            bin = EXCLUDED.bin,
            table_or_chair = EXCLUDED.table_or_chair,
            bbq = EXCLUDED.bbq,
            shade = EXCLUDED.shade,
            power = EXCLUDED.power,
            provider_type = EXCLUDED.provider_type,
            has_fuel_derived = EXCLUDED.has_fuel_derived,
            comments = EXCLUDED.comments,
            source_file_id = EXCLUDED.source_file_id,
            last_synced_at = now()
        """,
        {
            "radar_id": props["radar_id"],
            "name": props.get("name"),
            "road_name": props.get("road_name"),
            "locality": props.get("locality"),
            "state": props["state"],
            "lon": lon,
            "lat": lat,
            "heavy_vehicle_area": props.get("heavy_vehicle_area") == "Y",
            "toilet": yn_to_bool(props.get("toilet")),
            "disabled_toilet": yn_to_bool(props.get("disabled_toilet")),
            "lighting": yn_to_bool(props.get("lighting")),
            "shelter": yn_to_bool(props.get("shelter")),
            "water": yn_to_bool(props.get("water")),
            "bin": yn_to_bool(props.get("bin")),
            "table_or_chair": yn_to_bool(props.get("table_or_chair")),
            "bbq": yn_to_bool(props.get("bbq")),
            "shade": yn_to_bool(props.get("shade")),
            "power": yn_to_bool(props.get("power")),
            "provider_type": props.get("provider_type"),
            "has_fuel_derived": derive_has_fuel(props.get("provider_type")),
            "comments": props.get("comments"),
            "source_file_id": source_file_id,
        },
    )


def main():
    """Runs the full sync: fetch from NFDH, connect to Postgres, upsert every record."""
    # Load DB connection details from backend/db/.env, the same file the
    # rest of the team's local setup already uses.
    env_path = Path(__file__).resolve().parent.parent / "db" / ".env"
    load_dotenv(env_path)

    print("Fetching rest areas from the NFDH API...")
    features = fetch_rest_areas()
    print(f"Received {len(features)} records.")

    conn = psycopg.connect(
        host=os.environ.get("POSTGRES_HOST", "localhost"),
        port=os.environ.get("POSTGRES_PORT", "5432"),
        dbname=os.environ.get("POSTGRES_DB", "routerest"),
        user=os.environ.get("POSTGRES_USER", "postgres"),
        password=os.environ["POSTGRES_PASSWORD"],
    )
    try:
        with conn.cursor() as cursor:
            source_file_id = ensure_source_file(cursor)
            for feature in features:
                upsert_rest_area(cursor, feature, source_file_id)
        conn.commit()  # commit once at the end, so a mid-sync failure leaves the old data intact rather than half-updated
    finally:
        conn.close()

    print(f"Synced {len(features)} rest areas into the database.")


if __name__ == "__main__":
    main()
