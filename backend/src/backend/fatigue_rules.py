"""Looks up the NHVR fatigue rules that apply to one journey.

What this module does: turns a jurisdiction and driver configuration into
the ShortBreakCheckpoint and MajorRestRequirement objects rest_plan.py
needs, by reading them out of the fatigue_rule table. This is the only
place in the backend that knows fatigue_rule's column names, everything
downstream works with the plain dataclasses from rest_plan.py instead.
"""

import psycopg

from backend.rest_plan import MajorRestRequirement, ShortBreakCheckpoint

# The NHVR windows longer than a day (7-day, 14-day) are intentionally
# excluded here. Applying them correctly needs a driver's work/rest
# history from OTHER journeys, and per the project's privacy design that
# history is never stored on our server, so this backend has no way to
# evaluate them. See the module docstring in rest_plan.py.
MAX_WINDOW_HOURS_SUPPORTED = 24


class UnsupportedJurisdictionError(ValueError):
    """Raised when no fatigue rules exist for a jurisdiction_code, or the
    rules that do exist are ambiguous. Every jurisdiction the frontend
    can select now has seeded rules (six HVNL states, WA's own scheme,
    NT's HVNL-based default), so this means either an invalid code was
    passed, or seed_fatigue_rules*.sql has not been run. Kept as its own
    exception type so calling code (the API endpoint) can turn it into a
    specific, honest error message instead of a generic 500."""


def get_daily_fatigue_rules(
    conn: psycopg.Connection,
    jurisdiction_code: str,
    configuration: str,
) -> tuple[list[ShortBreakCheckpoint], MajorRestRequirement]:
    """Fetches the short-break checkpoints and the major rest requirement
    for one jurisdiction and driver configuration ('solo' or 'two_up').

    Returns a (short_breaks, major_rest) pair, ready to hand straight to
    rest_plan.generate_rest_plan.
    """
    with conn.cursor() as cursor:
        cursor.execute(
            """
            SELECT window_hours, max_work_minutes, min_rest_minutes
            FROM fatigue_rule
            WHERE jurisdiction_code = %(jurisdiction_code)s
              AND configuration = %(configuration)s
              AND window_hours <= %(max_window_hours)s
            ORDER BY window_hours ASC
            """,
            {
                "jurisdiction_code": jurisdiction_code,
                "configuration": configuration,
                "max_window_hours": MAX_WINDOW_HOURS_SUPPORTED,
            },
        )
        rows = cursor.fetchall()

    if not rows:
        raise UnsupportedJurisdictionError(
            f"No fatigue rules found for jurisdiction '{jurisdiction_code}' "
            f"({configuration}). Every jurisdiction the frontend offers has "
            "seeded rules; this means an invalid jurisdiction_code was passed, "
            "or seed_fatigue_rules.sql / seed_fatigue_rules_wa_nt.sql has not "
            "been run."
        )

    # The major rest is whichever fetched row has the LARGEST
    # max_work_minutes, that is the row representing the full working-day
    # cap. Not every jurisdiction names that cap "24 hours" the way the
    # HVNL states do (WA's is the "17-hour rule", see
    # seed_fatigue_rules_wa_nt.sql), but "the row with the biggest work
    # cap is the major rest" holds for every jurisdiction currently
    # seeded. Everything else fetched is a cumulative short-break
    # checkpoint building up to that cap.
    max_work_minutes_seen = max(row[1] for row in rows)
    short_break_rows = [row for row in rows if row[1] != max_work_minutes_seen]
    major_rest_rows = [row for row in rows if row[1] == max_work_minutes_seen]

    if len(major_rest_rows) > 1:
        # A data problem (a duplicate seed row), not a code problem, but
        # picking the first one silently would compute a plan against
        # arbitrary numbers rather than failing loudly, the same reason
        # the empty case above is guarded rather than left to KeyError.
        raise UnsupportedJurisdictionError(
            f"Fatigue rules for '{jurisdiction_code}' ({configuration}) have "
            f"{len(major_rest_rows)} rows tied for the major rest (largest "
            "max_work_minutes), expected exactly one; the data is ambiguous."
        )

    # WA runs its own separate scheme (Work Health and Safety (General)
    # Regulations 2022), not the HVNL, saying "NHVR" in a WA plan's
    # reason text would misattribute the actual regulation. Every other
    # seeded jurisdiction (the six HVNL states, and NT's borrowed
    # default, see seed_fatigue_rules_wa_nt.sql) genuinely uses NHVR's
    # numbers, so "NHVR" is correct for them.
    regulation_name = "WorkSafe WA" if jurisdiction_code == "WA" else "NHVR"

    short_breaks = [
        ShortBreakCheckpoint(
            window_hours=float(hours),
            max_work_minutes=work,
            min_rest_minutes=rest,
            regulation_name=regulation_name,
        )
        for hours, work, rest in short_break_rows
    ]
    window_hours, max_work_minutes, min_rest_minutes = major_rest_rows[0]
    major_rest = MajorRestRequirement(
        window_hours=float(window_hours),
        max_work_minutes=max_work_minutes,
        min_rest_minutes=min_rest_minutes,
        regulation_name=regulation_name,
    )

    return short_breaks, major_rest
