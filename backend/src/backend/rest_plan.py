"""Computes a proactive rest plan for a single journey (US 1.3).

What this module does: given how long a driver plans to drive for, works
out where the legally required rest breaks fall, using the NHVR Standard
Hours checkpoints. This is a pure calculation with no database or network
access, so it can be tested completely on its own.

Scope this module deliberately does NOT cover, so it is not mistaken for
more than it is:
  - The 7-day and 14-day NHVR windows are not applied here. Those require
    knowing a driver's work/rest history across OTHER journeys, and per
    the project's privacy design that history lives on the driver's own
    device, never on our server, so this module has no way to see it.
    This module only ever reasons about ONE journey, starting from a
    fully rested state.
  - Which specific co-driver takes which break (driver rotation) is not
    decided here. This module answers "when must a rest happen", not
    "who takes it"; rotation logic belongs to a later feature (Epic 4).
"""

from dataclasses import dataclass
from datetime import datetime, timedelta


@dataclass(frozen=True)
class ShortBreakCheckpoint:
    """One of a jurisdiction's short-break rules (5.5/8/11-hour under
    NHVR Standard Hours, or WA's single 5-hour rule, etc.): by the time
    this many minutes of work have accumulated, at least this many
    minutes of rest must have been taken in total. Checkpoints for the
    same jurisdiction share one running total of rest, reaching the
    largest checkpoint's requirement already satisfies the smaller ones
    passed along the way.

    window_hours is the window's own name in whichever regulation this
    checkpoint comes from (5.5, 8, or 11 under NHVR; 5 under WA's
    scheme), kept separate from max_work_minutes because the two are not
    the same number, a "5.5-hour window" caps WORK at 5.25 hours (315
    minutes), the other 15 minutes being the rest it requires.
    window_hours and regulation_name exist only to make the plan's
    reason text match how the applicable regulation is actually worded;
    the calculation itself never uses either.
    """

    window_hours: float
    max_work_minutes: int
    min_rest_minutes: int
    # Which regulation this checkpoint's numbers actually come from, e.g.
    # "NHVR" (the six HVNL states, and NT's borrowed default, see
    # seed_fatigue_rules_wa_nt.sql) or "WorkSafe WA" (WA's own separate
    # scheme). Defaults to "NHVR" since that covers most seeded
    # jurisdictions; callers for a non-NHVR jurisdiction must pass the
    # real name, saying "NHVR" for a WA plan would be factually wrong,
    # WA never adopted the HVNL that name refers to.
    regulation_name: str = "NHVR"


@dataclass(frozen=True)
class MajorRestRequirement:
    """A jurisdiction's single major-rest rule (NHVR's "24-hour rule" at
    a 12-hour work cap; WA's "17-hour rule" at a 17-hour work cap).
    Unlike the short-break checkpoints, this is a single continuous
    rest, not part of the same running total. Once cumulative work
    reaches max_work_minutes, the driver must take one continuous rest
    of at least min_rest_minutes before continuing to a new work day.
    Under NHVR, solo and two-up drivers have different minimums here (7
    hours solo, 5 hours two-up), which is the whole reason a co-driver
    changes the plan at all.

    window_hours and regulation_name exist for the same reason as on
    ShortBreakCheckpoint: only to word the plan's reason text correctly,
    never used in the calculation itself.
    """

    window_hours: float
    max_work_minutes: int
    min_rest_minutes: int
    regulation_name: str = "NHVR"


@dataclass(frozen=True)
class RestBreak:
    """One planned break in the journey, with a plain-language reason so
    the app can show the driver why it's there, not just when."""

    start: datetime
    end: datetime
    reason: str


def generate_rest_plan(
    short_breaks: list[ShortBreakCheckpoint],
    major_rest: MajorRestRequirement,
    departure_time: datetime,
    total_driving_minutes: float,
) -> list[RestBreak]:
    """Builds the ordered list of rest breaks for a journey.

    Inputs: the short-break checkpoints and major rest rule that apply
    (already looked up for the right jurisdiction and solo/two-up
    configuration), when the driver leaves, and how long the drive is
    expected to take in total (excluding rest).

    Output: rest breaks in journey order (AC 1.3.3), each with a start
    and end time and a reason. An empty list means no rest is legally
    required for a drive this short, which is itself a valid, useful
    answer, not a missing one.

    How it works: the journey is simulated one "work day" at a time. Each
    day, the driver works up to the major rest's cap, picking up any
    short breaks that fall due along the way; if driving remains after
    reaching that cap, a major rest is inserted and a new work day
    begins for whatever driving is left.
    """
    # short_breaks must be in ascending order of max_work_minutes for the
    # "cumulative rest so far" bookkeeping below to make sense; sorting
    # here means callers do not have to remember to do it themselves.
    ordered_checkpoints = sorted(short_breaks, key=lambda c: c.max_work_minutes)

    breaks: list[RestBreak] = []
    clock = departure_time
    # Rounded to the nearest whole minute: every NHVR checkpoint here is
    # itself a whole number of minutes, and total_driving_minutes usually
    # arrives as hours*60 from a decimal hours input (e.g. 8.3 hours),
    # which is not always exactly representable in binary floating point.
    # Without rounding, a work day that should end exactly at the major
    # rest cap can instead leave a sub-minute residual, and the strict
    # "remaining_driving_minutes > 0" check below would then insert an
    # entire spurious extra major rest for a fraction of a second of
    # phantom driving.
    remaining_driving_minutes = round(total_driving_minutes)

    while remaining_driving_minutes > 0:
        # How much driving happens in this work day: either all the
        # remaining driving, or the major rest cap, whichever is smaller.
        minutes_this_work_day = min(remaining_driving_minutes, major_rest.max_work_minutes)

        cumulative_work_minutes = 0.0

        # The checkpoints describe a cycle of work and rest, not a
        # one-off. Western Australia's rule is 20 minutes of rest for
        # every 5 hours of work, so in a long day it falls due again at
        # 10 hours and again at 15. Applying the set only once left a WA
        # driver with a single break and then twelve hours straight,
        # which is what a Melbourne to Perth plan showed. The cycle
        # repeats until the next checkpoint would fall beyond the end of
        # this work day.
        #
        # Under the NHVR checkpoints nothing changes: their largest mark
        # (11 hours of work) sits close enough to the 12-hour cap that a
        # second cycle can never start, which the tests hold in place.
        while cumulative_work_minutes < minutes_this_work_day:
            cycle_start_work_minutes = cumulative_work_minutes
            cycle_rest_minutes = 0.0
            reached_a_checkpoint = False

            for checkpoint in ordered_checkpoints:
                mark = cycle_start_work_minutes + checkpoint.max_work_minutes
                if mark > minutes_this_work_day:
                    # This checkpoint sits beyond how far the driver gets
                    # today, so it does not apply to this work day.
                    break

                # Drive from wherever we are up to this checkpoint's mark.
                clock += timedelta(minutes=mark - cumulative_work_minutes)
                cumulative_work_minutes = mark
                reached_a_checkpoint = True

                # Only insert a break for whatever rest is still owed
                # beyond what earlier checkpoints in this cycle already
                # covered, never double-count.
                rest_owed = checkpoint.min_rest_minutes - cycle_rest_minutes
                if rest_owed > 0:
                    break_start = clock
                    clock += timedelta(minutes=rest_owed)
                    breaks.append(RestBreak(
                        start=break_start,
                        end=clock,
                        reason=f"Short rest required under the {checkpoint.regulation_name} {checkpoint.window_hours:g}-hour rule",
                    ))
                    cycle_rest_minutes = checkpoint.min_rest_minutes

            if not reached_a_checkpoint:
                # The rest of this work day is shorter than the first
                # checkpoint, so no further break falls due today.
                break

        # Drive any remaining minutes in this work day past the last checkpoint reached.
        clock += timedelta(minutes=minutes_this_work_day - cumulative_work_minutes)
        remaining_driving_minutes -= minutes_this_work_day

        if remaining_driving_minutes > 0:
            # The journey needs more driving than one work day allows,
            # so the major rest is mandatory before a new day can start.
            break_start = clock
            clock += timedelta(minutes=major_rest.min_rest_minutes)
            breaks.append(RestBreak(
                start=break_start,
                end=clock,
                reason=f"Major rest required under the {major_rest.regulation_name} {major_rest.window_hours:g}-hour rule",
            ))

    return breaks
