import pytest

from backend.journey_scoring import calculate_journey_score


# Verify the score against independently calculated examples.
@pytest.mark.parametrize(
    "rests, checks, expected",
    [
        ([(15, 15)], [True, True], 100),
        ([(15, 15), (30, 15)], [True, True, False], 73.3333333333),
        ([(15, 0)], [True], 20),
        ([(15, 30)], [True, True], 100),
        ([], [True], 100),
        ([], [False], 0),
    ],
)
def test_journey_score(rests, checks, expected):
    result = calculate_journey_score(rests, checks)

    assert result["status"] == "scored"
    assert result["journey_score"] == pytest.approx(expected)
    assert result["scoring_version"] == "v1"
    assert result["rest_applicable"] == bool(rests)


# Unknown records must not produce a numeric score.
@pytest.mark.parametrize(
    "rests, checks",
    [
        ([(15, None)], [True]),
        ([(15, 15)], [True, None]),
    ],
)
def test_missing_data(rests, checks):
    result = calculate_journey_score(rests, checks)

    assert result["status"] == "insufficient_data"
    assert "journey_score" not in result


# Invalid inputs should be rejected rather than silently corrected.
@pytest.mark.parametrize(
    "rests, checks",
    [
        ([(0, 15)], [True]),
        ([(15, -1)], [True]),
        ([(float("nan"), 15)], [True]),
        ([(15, float("inf"))], [True]),
        ([], []),
        ([], ["yes"]),
    ],
)
def test_invalid_data(rests, checks):
    with pytest.raises(ValueError):
        calculate_journey_score(rests, checks)


from backend.journey_scoring import update_overall_rating


@pytest.mark.parametrize(
    "total, count, score, average, change",
    [(0, 0, 80, 80, None), (170, 2, 70, 80, -5), (160, 2, 100, 260 / 3, 20 / 3)],
)
def test_overall_rating(total, count, score, average, change):
    result = update_overall_rating(
        previous_total=total, previous_count=count, journey_score=score,
    )
    assert result["total_score"] == total + score
    assert result["journey_count"] == count + 1
    assert result["overall_average"] == pytest.approx(average)
    assert result["change"] == (None if change is None else pytest.approx(change))


@pytest.mark.parametrize(
    "total, count, score",
    [(1, 0, 80), (201, 2, 80), (0, -1, 80), (0, 0, 101)],
)
def test_invalid_overall_rating(total, count, score):
    with pytest.raises(ValueError):
        update_overall_rating(
            previous_total=total, previous_count=count, journey_score=score,
        )