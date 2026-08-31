"""Tests for the rest plan algorithm (backend.rest_plan).

Each test traces through the same NHVR Standard Hours checkpoints used
in production (see backend/db/seed_fatigue_rules.sql for where these
numbers come from) and checks the plan against a hand-worked-out answer,
not just "it returns something". Getting this wrong would mean the app
tells a driver an unsafe or non-compliant schedule is fine, so these
numbers are checked exactly, not just "roughly right".
"""

from datetime import datetime, timedelta

from backend.rest_plan import (
    MajorRestRequirement,
    ShortBreakCheckpoint,
    generate_rest_plan,
)

# The real solo Standard Hours short-break checkpoints (5.5h/8h/11h rows
# from fatigue_rule), used by every test below unless a test says otherwise.
SOLO_SHORT_BREAKS = [
    ShortBreakCheckpoint(window_hours=5.5, max_work_minutes=315, min_rest_minutes=15),
    ShortBreakCheckpoint(window_hours=8, max_work_minutes=450, min_rest_minutes=30),
    ShortBreakCheckpoint(window_hours=11, max_work_minutes=600, min_rest_minutes=60),
]
SOLO_MAJOR_REST = MajorRestRequirement(window_hours=24, max_work_minutes=720, min_rest_minutes=420)
TWO_UP_MAJOR_REST = MajorRestRequirement(window_hours=24, max_work_minutes=720, min_rest_minutes=300)

DEPARTURE = datetime(2026, 9, 1, 6, 0)  # 6:00am, an arbitrary fixed departure time


def test_short_journey_needs_no_rest():
    """A 3-hour drive never reaches the 5.5-hour checkpoint, so nothing
    should be scheduled at all, an empty plan is the correct answer here,
    not a bug."""
    plan = generate_rest_plan(SOLO_SHORT_BREAKS, SOLO_MAJOR_REST, DEPARTURE, total_driving_minutes=180)
    assert plan == []


def test_six_hour_drive_needs_exactly_one_short_break():
    """A 6-hour drive crosses the 5.5-hour checkpoint but not the 8-hour
    one, so exactly one 15-minute break should appear, timed at the
    5.25-hour mark (315 minutes after departure)."""
    plan = generate_rest_plan(SOLO_SHORT_BREAKS, SOLO_MAJOR_REST, DEPARTURE, total_driving_minutes=360)

    assert len(plan) == 1
    only_break = plan[0]
    assert only_break.start == datetime(2026, 9, 1, 11, 15)  # departure + 315 minutes
    assert only_break.end == datetime(2026, 9, 1, 11, 30)    # 15 minutes long
    assert "5.5-hour" in only_break.reason


def test_ten_hour_drive_escalates_through_all_three_short_checkpoints():
    """A 10-hour drive should trigger all three short-break checkpoints
    in order, with each break only covering the rest still owed beyond
    what the previous break already provided (15, then 15 more to reach
    30 total, then 30 more to reach 60 total), never double-counted."""
    plan = generate_rest_plan(SOLO_SHORT_BREAKS, SOLO_MAJOR_REST, DEPARTURE, total_driving_minutes=600)

    assert len(plan) == 3
    durations = [(b.end - b.start).total_seconds() / 60 for b in plan]
    assert durations == [15, 15, 30]
    # Every break must come after the one before it finishes, since a
    # plan that overlaps itself is not a plan a driver could follow.
    for earlier, later in zip(plan, plan[1:]):
        assert earlier.end <= later.start


def test_fourteen_hour_drive_triggers_the_major_rest_and_a_second_work_day():
    """A 14-hour total drive exceeds the 12-hour daily work cap, so after
    the three short breaks the driver must take the major 7-hour rest,
    then the remaining 2 hours of driving happens as a fresh work day
    (short of even the first short-break checkpoint, so it needs no
    further breaks of its own)."""
    plan = generate_rest_plan(SOLO_SHORT_BREAKS, SOLO_MAJOR_REST, DEPARTURE, total_driving_minutes=840)

    assert len(plan) == 4  # three short breaks plus one major rest
    major_break = plan[-1]
    assert (major_break.end - major_break.start).total_seconds() / 60 == 420
    assert "major rest" in major_break.reason.lower()
    # The major rest must start only once 12 hours of work has actually
    # accumulated: 6:00am departure + 12h driving + 60 minutes of short
    # breaks already taken along the way = 7:00pm.
    assert major_break.start == datetime(2026, 9, 1, 19, 0)


def test_two_up_major_rest_is_shorter_than_solo():
    """The whole reason a co-driver changes the plan: the major rest at
    the 12-hour mark is 5 hours for a two-up crew instead of 7, since the
    vehicle can keep moving with the other driver at the wheel."""
    plan = generate_rest_plan(SOLO_SHORT_BREAKS, TWO_UP_MAJOR_REST, DEPARTURE, total_driving_minutes=840)

    major_break = plan[-1]
    assert (major_break.end - major_break.start).total_seconds() / 60 == 300


def test_a_journey_needing_two_major_rests_gets_exactly_two():
    """A driving job long enough to span three work days (2 x 12h days
    plus a shorter third day) must trigger the major rest twice, once
    after each full day, not once, and not on the final partial day
    (which should end with driving, not another mandatory rest)."""
    total_minutes = 720 + 720 + 300  # two full 12h days plus 5 more hours
    plan = generate_rest_plan(SOLO_SHORT_BREAKS, SOLO_MAJOR_REST, DEPARTURE, total_driving_minutes=total_minutes)

    major_rests = [b for b in plan if "major rest" in b.reason.lower()]
    assert len(major_rests) == 2
    # The gap between the two major rests is the second work day's 12
    # hours of driving PLUS the same three short breaks (15+15+30=60 min)
    # every full work day accumulates on the way to its own major rest,
    # not 12 hours alone. Asserting the wrong, cleaner-looking number
    # here would hide a real bug if a future change stopped the second
    # day from taking its own short breaks.
    gap = major_rests[1].start - major_rests[0].end
    assert gap == timedelta(hours=12, minutes=60)


def test_driving_exactly_to_a_short_break_checkpoint():
    """Driving for exactly 315 minutes (5.25h) should still trigger the
    5.5-hour rule's break, the checkpoint is reached, not just passed."""
    plan = generate_rest_plan(SOLO_SHORT_BREAKS, SOLO_MAJOR_REST, DEPARTURE, total_driving_minutes=315)
    assert len(plan) == 1
    assert "5.5-hour" in plan[0].reason


def test_driving_exactly_to_the_major_rest_cap_needs_no_major_rest():
    """Driving for exactly 720 minutes (12h, the daily cap) should end the
    journey there. Nothing remains to drive, so no major rest should be
    inserted, that rest is only needed before MORE driving continues."""
    plan = generate_rest_plan(SOLO_SHORT_BREAKS, SOLO_MAJOR_REST, DEPARTURE, total_driving_minutes=720)
    major_rests = [b for b in plan if "major rest" in b.reason.lower()]
    assert major_rests == []


def test_decimal_hour_input_does_not_insert_a_phantom_major_rest():
    """Regression test for a floating-point bug: total_driving_minutes
    computed from hours * 60 (e.g. 8.3 hours) is not always an exact
    integer in binary floating point (8.3 * 60 can land a tiny fraction
    above 498.0). Before this was rounded inside generate_rest_plan, that
    kind of residual could trigger an entire spurious extra major rest
    for a fraction-of-a-second of phantom driving whenever a decimal
    hours input happened to land just past a checkpoint. 8.3 hours stays
    well under the first work day's 12-hour cap, so the correct answer
    is exactly one short break and no major rest at all."""
    plan = generate_rest_plan(SOLO_SHORT_BREAKS, SOLO_MAJOR_REST, DEPARTURE, total_driving_minutes=8.3 * 60)
    major_rests = [b for b in plan if "major rest" in b.reason.lower()]
    assert major_rests == []


def test_breaks_are_returned_in_journey_order():
    """AC 1.3.3 requires the plan displayed in journey order; since the
    algorithm builds breaks as it simulates forward through time, this
    should hold naturally, but it is checked explicitly so a future
    change to the algorithm cannot silently break this requirement."""
    plan = generate_rest_plan(SOLO_SHORT_BREAKS, SOLO_MAJOR_REST, DEPARTURE, total_driving_minutes=840)
    starts = [b.start for b in plan]
    assert starts == sorted(starts)
