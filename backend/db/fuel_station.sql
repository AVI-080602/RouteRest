-- ============================================================================
-- FUEL_STATION
-- A local copy of every fuel station in Australia from OpenStreetMap, so a
-- driver can ask "where's the nearest fuel?" anywhere in the country.
--
-- Why this table exists: the national rest area list (rest_area) has no
-- fuel field. Fuel there is only guessed from the operator type, which
-- marks 112 of 5,036 rest areas, 64 of them for heavy vehicles and none in
-- Victoria (checked 12 October 2026). OpenStreetMap lists about 7,600 fuel
-- stations across Australia.
--
-- Loaded and refreshed by backend/scripts/sync_fuel_stations.py, which also
-- runs this file, so an existing database only needs that one script. Like
-- rest_area, this is reference data: nothing here is about a driver, and a
-- search reads this table on our own server, so no driver location is sent
-- to OpenStreetMap at search time.
--
-- Licence: OpenStreetMap data is under the Open Database Licence (ODbL),
-- which requires "(c) OpenStreetMap contributors" wherever it is shown.
-- ============================================================================
CREATE TABLE IF NOT EXISTS fuel_station (
    osm_id          TEXT PRIMARY KEY,       -- "node/123" or "way/456": the source's own id, so a re-sync updates rows
    name            TEXT,
    brand           TEXT,
    operator        TEXT,
    location        GEOGRAPHY(POINT, 4326) NOT NULL,  -- a building or forecourt mapped as an area is stored at its centre
    -- Tags as mapped. NULL means "not mapped", which is most stations, and
    -- is a different fact from FALSE ("mapped as no"). Never coalesce.
    diesel          BOOLEAN,                -- fuel:diesel
    truck_diesel    BOOLEAN,                -- fuel:HGV_diesel, a high-flow truck pump
    truck_access    BOOLEAN,                -- hgv: yes or designated is TRUE, no is FALSE
    opening_hours   TEXT,                   -- OpenStreetMap opening_hours syntax, not parsed
    source_file_id  INTEGER NOT NULL REFERENCES source_file(id),
    last_synced_at  TIMESTAMPTZ NOT NULL
);

-- "Nearest fuel to this point" is a nearest-neighbour search, the same
-- kind the rest area index serves.
CREATE INDEX IF NOT EXISTS idx_fuel_station_location ON fuel_station USING GIST (location);
