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
    """Raised when no fatigue rules exist for a jurisdiction, which is
    expected and correct for Western Australia and the Northern
    Territory (the Heavy Vehicle National Law does not apply there), but
    is a real problem for any of the six jurisdictions that should have
    rules seeded. Kept as its own exception type so calling code (the
    API endpoint) can turn it into a specific, honest error message
    instead of a generic 500."""


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
            f"({configuration}). If this is WA or NT, that is expected, the "
            "Heavy Vehicle National Law does not apply there. For any other "
            "jurisdiction, this means seed_fatigue_rules.sql has not been run."
        )

    # The 24-hour row is the major rest; everything shorter is a
    # cumulative short-break checkpoint. This split matches how the
    # numbers were deliberately seeded, see seed_fatigue_rules.sql.
    short_break_rows = [row for row in rows if row[0] < MAX_WINDOW_HOURS_SUPPORTED]
    major_rest_rows = [row for row in rows if row[0] == MAX_WINDOW_HOURS_SUPPORTED]

    if not major_rest_rows:
        raise UnsupportedJurisdictionError(
            f"Fatigue rules for '{jurisdiction_code}' ({configuration}) have no "
            "24-hour major rest row; the data is incomplete."
        )
    if len(major_rest_rows) > 1:
        # A data problem (a duplicate seed row), not a code problem, but
        # picking the first one silently would compute a plan against
        # arbitrary numbers rather than failing loudly, the same reason
        # the empty case above is guarded rather than left to KeyError.
        raise UnsupportedJurisdictionError(
            f"Fatigue rules for '{jurisdiction_code}' ({configuration}) have "
            f"{len(major_rest_rows)} 24-hour major rest rows, expected exactly "
            "one; the data is ambiguous."
        )

    short_breaks = [
        ShortBreakCheckpoint(window_hours=float(hours), max_work_minutes=work, min_rest_minutes=rest)
        for hours, work, rest in short_break_rows
    ]
    window_hours, max_work_minutes, min_rest_minutes = major_rest_rows[0]
    major_rest = MajorRestRequirement(
        window_hours=float(window_hours),
        max_work_minutes=max_work_minutes,
        min_rest_minutes=min_rest_minutes,
    )

    return short_breaks, major_rest
