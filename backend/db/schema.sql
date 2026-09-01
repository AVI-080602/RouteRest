-- ============================================================================
-- RouteRest database schema
--
-- What this file is for: the PostgreSQL/PostGIS schema for Iteration 1
-- (Epic 1, Safe & Proactive Journey Planning, and Epic 2, Smart Stop &
-- Refuel Planning), covering user stories US 1.1 to US 1.5 and US 2.1 to
-- US 2.5 as currently on the team board.
--
-- Design principles this file follows (see RouteRight_Data_Management_Plan.docx
-- for the full reasoning, though that document still describes an earlier
-- design and needs updating to match this):
--   1. No driver accounts, and no user/journey data on our server AT ALL.
--      The project brief requires that any data about a specific user's
--      journey lives only on that user's own device, never in our
--      database. This file therefore holds NO journey, waypoint, rest
--      plan, or driver-state tables; those are frontend/local-storage
--      concerns, not database concerns. What follows is reference data
--      only: facts that are the same for every driver, not about any one
--      person's trip.
--   2. Because of (1), "continue the journey on another phone" (US 1.4)
--      is a direct device-to-device handoff (the first phone shows a QR
--      code encoding the journey, the second phone scans it), never a
--      server-stored record. Our database plays no part in that feature.
--   3. Live routing (OpenRouteService/Valhalla) and map data are NEVER
--      stored here either; only reference data the app needs to remember
--      lives in this schema.
--   4. Every external dataset we depend on (rest areas, NHVR rules, vehicle
--      specs) is traceable back to SOURCE_FILE, so a marker or teammate can
--      always ask "where did this number come from".
--   5. Epic 6 (anonymous rest-area feedback) and Epic 3/4 (fatigue risk
--      history) are deliberately NOT modelled yet. Building their tables
--      before those epics are underway would be scope creep; add them when
--      that work actually starts, and only if they hold no personal data
--      (see principle 1).
--
-- How to use this file: see backend/db/README.md for local setup steps.
-- ============================================================================

-- PostGIS gives us spatial types (geography/geometry) and distance queries,
-- which we need for "find rest areas near this route" (US 2.1, US 2.2).
CREATE EXTENSION IF NOT EXISTS postgis;


-- ============================================================================
-- SOURCE_FILE
-- Audit trail for every external dataset the app depends on. Other tables
-- (REST_AREA, FATIGUE_RULE, VEHICLE_MODEL) point back to a row here so we
-- can always answer "what source, what licence, when did we last check it".
-- ============================================================================
CREATE TABLE source_file (
    id              SERIAL PRIMARY KEY,
    source_name     TEXT NOT NULL,          -- human label, e.g. "NFDH National Formal Rest Areas"
    publisher       TEXT NOT NULL,          -- e.g. "Department of Infrastructure (NFDH)"
    licence         TEXT,                   -- e.g. "CC BY 4.0", or NULL if "not specified" (see NFDH note)
    url             TEXT,                   -- where we got it from
    retrieved_at    TIMESTAMPTZ NOT NULL,   -- when this data was last pulled/verified
    notes           TEXT                    -- anything a reader needs to know (caveats, quirks)
);


-- ============================================================================
-- JURISDICTION
-- Small reference table so the app knows the Heavy Vehicle National Law
-- does NOT apply in WA or NT (US 1.5, AC 1.5.3/1.5.4). Kept as data, not
-- hardcoded in application logic, so it is easy to correct if the law
-- changes again (it already did, on 1 August 2026).
-- ============================================================================
CREATE TABLE jurisdiction (
    code            TEXT PRIMARY KEY,       -- e.g. 'VIC', 'NSW', 'WA'
    name            TEXT NOT NULL,          -- e.g. 'Victoria'
    hvnl_applies    BOOLEAN NOT NULL        -- FALSE for WA and NT
);


-- ============================================================================
-- FATIGUE_RULE
-- The NHVR Standard Hours tables, hand-transcribed from the regulator's
-- published page (see source_file_id). One row per (jurisdiction,
-- configuration, window) combination, e.g. "VIC, solo, 24 hours".
-- This is the data the Safe Schedule Check (US 1.2) and the Proactive Rest
-- Plan (US 1.3) compute against, and what US 1.5 displays to the driver.
-- ============================================================================
CREATE TABLE fatigue_rule (
    id                          SERIAL PRIMARY KEY,
    jurisdiction_code           TEXT NOT NULL REFERENCES jurisdiction(code),
    configuration               TEXT NOT NULL CHECK (configuration IN ('solo', 'two_up')),
    window_hours                NUMERIC(6,2) NOT NULL,  -- size of the window this row describes, e.g. 5.5, 24, 168 (7 days)
    max_work_minutes            INTEGER,                -- maximum work time allowed in that window (NULL if the window is rest-only, e.g. the two-up 52-hour row)
    min_rest_minutes            INTEGER NOT NULL,       -- minimum rest required in that window
    rest_block_minutes          INTEGER,                -- if rest must come in blocks of at least this size (NULL if not applicable)
    requires_night_rest_break   BOOLEAN NOT NULL DEFAULT FALSE, -- TRUE for rows requiring a 10pm-8am style night rest break
    night_rest_breaks_required  SMALLINT,               -- how many night rest breaks this window requires (e.g. 2 for the 14-day row)
    notes                       TEXT,                   -- anything that doesn't fit cleanly into columns (e.g. "sleeper berth alternative allowed")
    source_file_id              INTEGER NOT NULL REFERENCES source_file(id),
    retrieved_date              DATE NOT NULL,          -- stamped separately from source_file so a rule can be re-verified independently
    -- one rule row per jurisdiction + configuration + window size
    UNIQUE (jurisdiction_code, configuration, window_hours)
);


-- ============================================================================
-- VEHICLE_MODEL
-- The curated truck spec table (US 2.3, "Find Compatible Refuelling").
-- Not an external API; the team builds and maintains this list from
-- manufacturer spec sheets, one source_file_id row per entry so each
-- number is traceable.
-- ============================================================================
CREATE TABLE vehicle_model (
    id                      SERIAL PRIMARY KEY,
    make                    TEXT NOT NULL,              -- e.g. 'Volvo'
    model                   TEXT NOT NULL,              -- e.g. 'FH16'
    configuration           TEXT NOT NULL CHECK (configuration IN ('rigid', 'semi_trailer', 'b_double')),
    -- height_m and weight_kg are nullable on purpose, same principle as the
    -- facility flags on rest_area: several manufacturers (Kenworth in
    -- particular) treat these as customer order-sheet options rather than
    -- publishing one fixed spec-sheet figure, so NULL means "not publicly
    -- confirmed for this model", not zero or "doesn't matter". Application
    -- code must fall back to the conservative routing default (4.3 m,
    -- 42.5 t) when a selected vehicle has a NULL here, the same fallback
    -- already used when no vehicle is selected at all.
    height_m                NUMERIC(4,2),               -- used as an OpenRouteService HGV routing parameter
    weight_kg               INTEGER,                    -- used as an OpenRouteService HGV routing parameter
    tank_capacity_l         INTEGER,                    -- NULL where unknown; treated as a default the driver can override
    fuel_type               TEXT NOT NULL CHECK (fuel_type IN ('diesel', 'petrol', 'other')),
    consumption_l_per_100km NUMERIC(5,2),               -- used to estimate remaining range for refuel planning; may be an ABS class average rather than a model-specific figure, see notes per row
    source_file_id          INTEGER REFERENCES source_file(id),
    notes                   TEXT
);


-- ============================================================================
-- REST_AREA
-- A local cache of the NFDH National Formal Rest Areas dataset, refreshed
-- periodically rather than queried live on every request (see
-- RouteRight_Data_Management_Plan.docx, section 3). radar_id is the
-- source's own identifier, kept as a natural key so re-syncing the dataset
-- updates existing rows instead of duplicating them.
-- ============================================================================
CREATE TABLE rest_area (
    radar_id            INTEGER PRIMARY KEY,       -- the NFDH source's own record id, not one we invent
    name                TEXT,
    road_name           TEXT,
    locality            TEXT,
    state               TEXT NOT NULL,
    location            GEOGRAPHY(POINT, 4326) NOT NULL,  -- WGS84 lon/lat; always requested with outSR=4326 from the source (see the coordinate-system note in the data plan)
    heavy_vehicle_area  BOOLEAN NOT NULL DEFAULT FALSE,
    -- Facility flags: nullable, because NULL means "not published for this
    -- state", which is a different fact from FALSE ("confirmed absent").
    -- Never coalesce these to FALSE without thinking about what that implies.
    toilet              BOOLEAN,
    disabled_toilet     BOOLEAN,
    lighting            BOOLEAN,
    shelter             BOOLEAN,
    water               BOOLEAN,
    bin                 BOOLEAN,
    table_or_chair      BOOLEAN,
    bbq                 BOOLEAN,
    shade               BOOLEAN,
    power               BOOLEAN,
    provider_type       TEXT,               -- e.g. 'SERVICE CENTRE'; the only signal we have for fuel/food (see has_fuel_derived)
    has_fuel_derived     BOOLEAN NOT NULL DEFAULT FALSE, -- TRUE only when provider_type suggests fuel is available; NFDH has no real fuel field, so this is an inference, not a fact
    comments            TEXT,               -- source free-text; sometimes contains bay counts NFDH doesn't structure
    source_file_id      INTEGER NOT NULL REFERENCES source_file(id),
    last_synced_at      TIMESTAMPTZ NOT NULL
);

-- Spatial index: without this, "find rest areas within N km of this route"
-- (US 2.1, US 2.2) would scan every row on every request.
CREATE INDEX idx_rest_area_location ON rest_area USING GIST (location);
CREATE INDEX idx_rest_area_state ON rest_area (state);


-- ============================================================================
-- Journey data: deliberately NOT a table in this file.
--
-- A journey (departure time, destination, fuel level, target arrival,
-- driver count, the schedule check result, the rest plan, each driver's
-- elapsed work/rest time, the selected stop) is all data about one
-- specific user's trip. Per the project brief, that never touches our
-- server, so there is no JOURNEY, JOURNEY_WAYPOINT, JOURNEY_DRIVER_STATE,
-- or REST_PLAN_ITEM table here. All of that lives in the frontend's local
-- storage on the driver's own device.
--
-- "Continue the journey on another phone" (US 1.4) is solved without the
-- database: the first phone encodes the journey as a QR code, the second
-- phone scans it and writes the same data into its own local storage.
-- The backend never sees this handoff happen.
-- ============================================================================


-- ============================================================================
-- Seed data: jurisdictions
-- The Heavy Vehicle National Law applies in these six; it does not apply
-- in WA or NT, which is exactly the fact US 1.5's WA/NT notice depends on.
-- ============================================================================
INSERT INTO jurisdiction (code, name, hvnl_applies) VALUES
    ('VIC', 'Victoria', TRUE),
    ('NSW', 'New South Wales', TRUE),
    ('QLD', 'Queensland', TRUE),
    ('SA',  'South Australia', TRUE),
    ('TAS', 'Tasmania', TRUE),
    ('ACT', 'Australian Capital Territory', TRUE),
    ('WA',  'Western Australia', FALSE),
    ('NT',  'Northern Territory', FALSE);
