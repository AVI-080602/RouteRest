-- ============================================================================
-- Seed data: NHVR Standard Hours fatigue rules
--
-- What this file is for: populates fatigue_rule with the actual National
-- Heavy Vehicle Regulator Standard Hours limits for solo and two-up
-- drivers, transcribed from the regulator's published page. This is the
-- data the Safe Schedule Check (US 1.2) and Proactive Rest Plan (US 1.3)
-- compute against.
--
-- Source: https://www.nhvr.gov.au/safety-accreditation-compliance/fatigue-management/work-and-rest-requirements/standard-hours
-- Retrieved and verified: 20 August 2026.
--
-- IMPORTANT: the Heavy Vehicle National Law was reformed on 1 August 2026
-- and the NHVR's own guidance pages were marked "transitional" at the time
-- these numbers were retrieved. Recheck this file against the live page
-- before relying on it for anything beyond development, and update
-- retrieved_date below (and re-run this file) once reconfirmed.
--
-- Why one row is written per configuration, not per jurisdiction: the
-- Standard Hours limits are a NATIONAL rule set, identical in every state
-- where the Heavy Vehicle National Law applies. Writing the numbers once
-- and cross-joining against jurisdiction avoids repeating ~80 rows by
-- hand, where a typo in one state's copy could silently create a rule
-- that disagrees with the same row in another state.
--
-- How to run: after schema.sql has been applied,
--   psql -U postgres -d routerest -f seed_fatigue_rules.sql
-- ============================================================================

-- One source_file row, referenced by every fatigue_rule row inserted below.
INSERT INTO source_file (source_name, publisher, licence, url, retrieved_at, notes)
VALUES (
    'NHVR Standard Hours (Heavy Vehicle National Law)',
    'National Heavy Vehicle Regulator',
    NULL, -- not a licensed dataset; a legal reference, not something NHVR publishes under a data licence
    'https://www.nhvr.gov.au/safety-accreditation-compliance/fatigue-management/work-and-rest-requirements/standard-hours',
    '2026-08-20T00:00:00+10',
    'Heavy Vehicle National Law reformed 1 August 2026; guidance pages were marked transitional at retrieval. Recheck before relying on this beyond development. Applies in VIC, NSW, QLD, SA, TAS, ACT only, not WA or NT (see the jurisdiction table).'
);

-- Solo driver Standard Hours, cross-joined onto every jurisdiction where
-- the Heavy Vehicle National Law actually applies (hvnl_applies = TRUE
-- excludes WA and NT automatically, they are not silently included).
INSERT INTO fatigue_rule (
    jurisdiction_code, configuration, window_hours, max_work_minutes,
    min_rest_minutes, rest_block_minutes, requires_night_rest_break,
    night_rest_breaks_required, notes, source_file_id, retrieved_date
)
SELECT
    j.code, r.configuration, r.window_hours, r.max_work_minutes,
    r.min_rest_minutes, r.rest_block_minutes, r.requires_night_rest_break,
    r.night_rest_breaks_required, r.notes,
    (SELECT id FROM source_file WHERE source_name = 'NHVR Standard Hours (Heavy Vehicle National Law)'),
    DATE '2026-08-20'
FROM jurisdiction j
CROSS JOIN (VALUES
    -- configuration, window_hours, max_work_minutes, min_rest_minutes, rest_block_minutes, requires_night_rest_break, night_rest_breaks_required, notes
    ('solo', 5.5::numeric,  315,  15,   NULL::integer, FALSE, NULL::smallint,
        'Rest may be taken as a single continuous break of at least 15 minutes.'),
    ('solo', 8::numeric,    450,  30,   15,             FALSE, NULL,
        'Rest may be split into blocks of at least 15 continuous minutes each, totalling at least 30 minutes.'),
    ('solo', 11::numeric,   600,  60,   15,             FALSE, NULL,
        'Rest may be split into blocks of at least 15 continuous minutes each, totalling at least 60 minutes.'),
    ('solo', 24::numeric,   720,  420,  NULL,           FALSE, NULL,
        'Must be one continuous stationary rest period of at least 7 hours.'),
    ('solo', 168::numeric,  4320, 1440, NULL,           FALSE, NULL,
        'The 7-day window. Must be one continuous stationary rest period of at least 24 hours.'),
    ('solo', 336::numeric,  8640, 420,  NULL,           TRUE,  2,
        'The 14-day window. Requires 2 night rest breaks (each at least 7 continuous hours of stationary rest, taken between 10pm and 8am in the time zone of the driver''s base, or a 24-hour continuous stationary rest break instead), with at least 2 of the required night rest breaks taken on consecutive days.')
) AS r(configuration, window_hours, max_work_minutes, min_rest_minutes, rest_block_minutes, requires_night_rest_break, night_rest_breaks_required, notes)
WHERE j.hvnl_applies = TRUE;

-- Two-up (co-driver) Standard Hours, same cross-join pattern.
INSERT INTO fatigue_rule (
    jurisdiction_code, configuration, window_hours, max_work_minutes,
    min_rest_minutes, rest_block_minutes, requires_night_rest_break,
    night_rest_breaks_required, notes, source_file_id, retrieved_date
)
SELECT
    j.code, r.configuration, r.window_hours, r.max_work_minutes,
    r.min_rest_minutes, r.rest_block_minutes, r.requires_night_rest_break,
    r.night_rest_breaks_required, r.notes,
    (SELECT id FROM source_file WHERE source_name = 'NHVR Standard Hours (Heavy Vehicle National Law)'),
    DATE '2026-08-20'
FROM jurisdiction j
CROSS JOIN (VALUES
    ('two_up', 5.5::numeric, 315,  15,   NULL::integer, FALSE, NULL::smallint,
        'Rest may be taken as a single continuous break of at least 15 minutes.'),
    ('two_up', 8::numeric,   450,  30,   15,             FALSE, NULL,
        'Rest may be split into blocks of at least 15 continuous minutes each, totalling at least 30 minutes.'),
    ('two_up', 11::numeric,  600,  60,   15,             FALSE, NULL,
        'Rest may be split into blocks of at least 15 continuous minutes each, totalling at least 60 minutes.'),
    ('two_up', 24::numeric,  720,  300,  NULL,           FALSE, NULL,
        'Must be one continuous stationary rest period of at least 5 hours, OR at least 5 continuous hours of rest in an approved sleeper berth while the vehicle is moving.'),
    ('two_up', 52::numeric,  NULL, 600,  NULL,           FALSE, NULL,
        'No work-time cap for this window; a rest-only requirement. Requires one continuous stationary rest period of at least 10 hours.'),
    ('two_up', 168::numeric, 3600, 1440, 420,            FALSE, NULL,
        'The 7-day window. Requires at least 24 continuous hours of stationary rest in total, taken in blocks of at least 7 continuous hours each.'),
    ('two_up', 336::numeric, 7200, 420,  NULL,           TRUE,  2,
        'The 14-day window. Requires 2 night rest breaks (each at least 7 continuous hours of stationary rest, or a 24-hour continuous stationary rest break instead), with at least 2 of the required night rest breaks taken on consecutive days.')
) AS r(configuration, window_hours, max_work_minutes, min_rest_minutes, rest_block_minutes, requires_night_rest_break, night_rest_breaks_required, notes)
WHERE j.hvnl_applies = TRUE;
