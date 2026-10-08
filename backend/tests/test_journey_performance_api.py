import pytest
from fastapi.testclient import TestClient

from backend.main import app


@pytest.fixture
def client(monkeypatch):
    # Avoid database cleanup during test application startup.
    monkeypatch.setattr("backend.main.remove_expired", lambda: 0)
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def payload():
    return {
        "journey_id": "92a359b1-07b1-40ca-8c78-f26e71901744",
        "status": "completed",
        "rests": [{"required_minutes": 15, "actual_minutes": 15}],
        "checks": [True, True],
        "previous_total": 0,
        "previous_count": 0,
    }


@pytest.mark.parametrize(
    "total, count, average, change",
    [(0, 0, 100, None), (170, 2, 90, 5)],
)
def test_success(client, payload, total, count, average, change):
    payload.update(previous_total=total, previous_count=count)
    response = client.post("/journeys/performance/evaluate", json=payload)
    assert response.status_code == 200
    result = response.json()
    assert result["journey"]["journey_score"] == 100
    assert result["overall"]["journey_count"] == count + 1
    assert result["overall"]["overall_average"] == average
    assert result["overall"]["change"] == change


def test_missing_data(client, payload):
    payload["rests"][0]["actual_minutes"] = None
    response = client.post("/journeys/performance/evaluate", json=payload)
    assert response.status_code == 200
    assert response.json()["journey"]["status"] == "insufficient_data"
    assert response.json()["overall"] is None

@pytest.mark.parametrize("patch", [
    {"status": "in_progress"},
    {"previous_total": 201, "previous_count": 2},
    {"checks": ["yes"]},
    {"checks": []},
])
def test_invalid_request(client, payload, patch):
    payload.update(patch)
    response = client.post("/journeys/performance/evaluate", json=payload)
    assert response.status_code == 422