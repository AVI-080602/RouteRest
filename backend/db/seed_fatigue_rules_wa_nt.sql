-- ============================================================================
-- Seed data: Western Australia and Northern Territory fatigue rules
--
-- What this file is for: adds WA and NT to fatigue_rule, which
-- seed_fatigue_rules.sql deliberately left empty for (WA and NT never
-- adopted the Heavy Vehicle National Law that file's numbers come from).
-- This file's two states are NOT the same kind of source, see each
-- section below, one is real state law, the other is this app's own
-- conservative default standing in for a state that has no fixed numbers
-- of its own. Both are single-journey, single-day-window numbers only,
-- same scope limit as seed_fatigue_rules.sql (see rest_plan.py's
-- module docstring for why: multi-day windows need cross-journey
-- history this app never has access to).
--
-- IMPORTANT SCOPE NOTE, enforced in the frontend, not this data: because
-- WA's numbers genuinely differ from the HVNL states, this app only
-- computes a WA plan when BOTH the departure and every destination
-- resolve to Western Australia (never applies WA rules to only part of
-- a route that crosses a state line), see newjourney/page.tsx's
-- jurisdiction cross-border check. Same restriction is applied to NT
-- for consistency, even though NT's numbers happen to equal the HVNL
-- ones here.
--
-- How to run: after schema.sql and seed_fatigue_rules.sql have been
-- applied,
--   psql -U postgres -d routerest -f seed_fatigue_rules_wa_nt.sql
-- ============================================================================


-- ============================================================================
-- WESTERN AUSTRALIA
-- Real, sourced, separate state law, genuinely different numbers from the
-- HVNL states. Work Health and Safety (General) Regulations 2022 (WA).
-- Source verified 2026-09-03: WorkSafe WA's own FAQ page states drivers
-- need "20 minutes breaks from driving" for "every 5 hours of work
-- time", and may work up to "17 hours elapsed time" in a single stretch
-- only if flanked by "a break of at least seven continuous hours
-- immediately before and after". The source also has a 72-hour/27-hour
-- rule (3 breaks of 7+ continuous hours in 72 hours), a multi-day window
-- out of this app's scope for the same reason the HVNL 7-day/14-day
-- windows are (see the file header above).
-- The source states rules "apply equally to multi-driver teams" without
-- giving separate two-up figures, so the same numbers are used for both
-- configurations here, not an assumption, that is what the source says.
-- ============================================================================
INSERT INTO source_file (source_name, publisher, licence, url, retrieved_at, notes)
VALUES (
    'Frequently asked questions: fatigue management for commercial vehicle drivers',
    'WorkSafe WA (Work Health and Safety (General) Regulations 2022)',
    NULL,
    'https://www.worksafe.wa.gov.au/frequently-asked-questions-fatigue-management-commercial-vehicle-drivers',
    '2026-09-03T00:00:00+08',
    'WA never adopted the Heavy Vehicle National Law; this is WA''s own separate state scheme under WHS regulations, not NHVR/HVNL. Numbers are genuinely different from the six HVNL states (looser single-work-period cap, 17h vs 12h). No separate two-up figures given, source says the rules apply equally to multi-driver teams.'
);

INSERT INTO fatigue_rule (
    jurisdiction_code, configuration, window_hours, max_work_minutes,
    min_rest_minutes, rest_block_minutes, requires_night_rest_break,
    night_rest_breaks_required, notes, source_file_id, retrieved_date
)
SELECT
    'WA', r.configuration, r.window_hours, r.max_work_minutes,
    r.min_rest_minutes, r.rest_block_minutes, r.requires_night_rest_break,
    r.night_rest_breaks_required, r.notes,
    (SELECT id FROM source_file WHERE source_name = 'Frequently asked questions: fatigue management for commercial vehicle drivers'),
    DATE '2026-09-03'
FROM (VALUES
    ('solo', 5::numeric, 300, 20, NULL::integer, FALSE, NULL::smallint,
        '20 minutes off driving required for every 5 hours of work time.'),
    ('solo', 17::numeric, 1020, 420, NULL, FALSE, NULL,
        'A single work period of up to 17 elapsed hours is allowed only when flanked by at least 7 continuous hours of rest immediately before and after. This app assumes a journey starts fully rested (see rest_plan.py), so only the AFTER requirement is modelled here, the BEFORE requirement is satisfied by that starting assumption.'),
    ('two_up', 5::numeric, 300, 20, NULL, FALSE, NULL,
        'Source states WA rules apply equally to multi-driver teams; no separate two-up figure is published, so the solo number is reused.'),
    ('two_up', 17::numeric, 1020, 420, NULL, FALSE, NULL,
        'Same as solo two_up note above: no separate two-up figure published for this window either.')
) AS r(configuration, window_hours, max_work_minutes, min_rest_minutes, rest_block_minutes, requires_night_rest_break, night_rest_breaks_required, notes);


-- ============================================================================
-- NORTHERN TERRITORY
-- NOT real NT law. NT has NO fixed numeric hour/rest limits of its own,
-- it uses an outcome-based duty-of-care model under the NT WHS Act
-- instead (verified 2026-09-03: nt.gov.au's own fatigue-management page
-- states NT "does not regulate driving hours under transport law" and
-- instead relies on the general WHS duty to provide a safe workplace).
-- For cross-border operators, NT explicitly RECOGNISES the HVNL (for
-- trips into HVNL states) or WA's scheme (for trips into WA), rather
-- than mandating its own numbers.
--
-- Since this app needs SOME numeric answer to compute a plan against,
-- and refusing NT entirely (like WA/NT both were before this file)
-- is a worse outcome than a clearly-labelled conservative default, the
-- HVNL Standard Hours numbers are reused here for NT, this is this
-- app's own engineering choice, not a claim about NT's actual law.
-- The frontend must show this distinction to the driver, not just bury
-- it in this comment, see newjourney/page.tsx's NT note.
-- ============================================================================
INSERT INTO source_file (source_name, publisher, licence, url, retrieved_at, notes)
VALUES (
    'Fatigue management for operating across borders',
    'Northern Territory Government (nt.gov.au)',
    NULL,
    'https://nt.gov.au/driving/industry/fatigue-management/operating-across-borders',
    '2026-09-03T00:00:00+09:30',
    'Confirms NT has NO fixed numeric hour/rest limits of its own for heavy vehicle drivers, an outcome-based WHS duty-of-care model applies instead. The fatigue_rule rows inserted for NT below are NOT sourced from this page''s numbers (it has none), they are the HVNL Standard Hours figures reused as this app''s own conservative default, since NT itself recognises the HVNL for cross-border legitimacy. Flag this clearly in the UI whenever NT is selected, do not present these as NT''s own mandated law.'
);

INSERT INTO fatigue_rule (
    jurisdiction_code, configuration, window_hours, max_work_minutes,
    min_rest_minutes, rest_block_minutes, requires_night_rest_break,
    night_rest_breaks_required, notes, source_file_id, retrieved_date
)
SELECT
    'NT', configuration, window_hours, max_work_minutes,
    min_rest_minutes, rest_block_minutes, requires_night_rest_break,
    night_rest_breaks_required,
    'Borrowed from the HVNL Standard Hours figures (see seed_fatigue_rules.sql), this app''s own default since NT has no fixed numbers of its own, NOT NT''s actual mandated law. ' || COALESCE(notes, ''),
    (SELECT id FROM source_file WHERE source_name = 'Fatigue management for operating across borders'),
    DATE '2026-09-03'
FROM fatigue_rule
WHERE jurisdiction_code = 'VIC' AND window_hours <= 24;
