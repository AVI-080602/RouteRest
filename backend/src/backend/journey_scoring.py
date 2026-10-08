from math import isfinite
from statistics import fmean


def calculate_journey_score(
    rests: list[tuple[float, float | None]],
    checks: list[bool | None],
) -> dict:
    """Calculate a completed journey's score without storing data."""
    # Validate values before calculating or identifying missing data.
    if not checks:
        raise ValueError("At least one expected state check is required.")

    if any(value is not None and type(value) is not bool for value in checks):
        raise ValueError("Check outcomes must be True, False or None.")

    for required, actual in rests:
        if not isfinite(required) or required <= 0:
            raise ValueError("Planned rest minutes must be positive.")
        if actual is not None and (not isfinite(actual) or actual < 0):
            raise ValueError("Actual rest minutes cannot be negative.")

    # Unknown data must not be treated as a skipped or successful action.
    if any(actual is None for _, actual in rests) or None in checks:
        return {"status": "insufficient_data", "scoring_version": "v1"}

    check_ratio = sum(value is True for value in checks) / len(checks)

    # When no rest is planned, only state checks contribute to the score.
    rest_points = None
    if rests:
        rest_points = 80 * fmean(
            min(actual / required, 1)
            for required, actual in rests
            if actual is not None
        )
    check_points = check_ratio * (20 if rests else 100)

    return {
        "status": "scored",
        "scoring_version": "v1",
        "journey_score": (rest_points or 0) + check_points,
        "rest_points": rest_points,
        "check_points": check_points,
        "rest_applicable": bool(rests),
    }

def update_overall_rating(
    *,
    previous_total: float,
    previous_count: int,
    journey_score: float,
) -> dict:
    """Combine one new journey score with the existing rating history."""
    if type(previous_count) is not int or previous_count < 0:
        raise ValueError("Journey count must be a non-negative integer.")
    if not isfinite(previous_total) or not (
        0 <= previous_total <= 100 * previous_count
    ):
        raise ValueError("Previous total is inconsistent with journey count.")
    if not isfinite(journey_score) or not 0 <= journey_score <= 100:
        raise ValueError("Journey score must be between 0 and 100.")

    # No previous average exists for the first scored journey.
    previous_average = (
        previous_total / previous_count if previous_count else None
    )
    new_total = previous_total + journey_score
    new_count = previous_count + 1
    overall_average = new_total / new_count

    return {
        "total_score": new_total,
        "journey_count": new_count,
        "previous_average": previous_average,
        "overall_average": overall_average,
        "change": (
            overall_average - previous_average
            if previous_average is not None else None
        ),
    }

if __name__ == "__main__":
    print(update_overall_rating(previous_total=0, previous_count=0, journey_score=80))
    print(update_overall_rating(previous_total=170, previous_count=2, journey_score=70))