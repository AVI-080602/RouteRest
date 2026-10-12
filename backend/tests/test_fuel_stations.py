"""Tests for the fuel station search (backend.fuel_stations and its
endpoint), without a database: the tag parsing and naming are pure, and
the endpoint is tested with the database call replaced."""

import pytest
from fastapi.testclient import TestClient

from backend.fuel_stations import NearbyFuelStation, display_name, osm_yes_no
from backend.main import app


# ---- What the OpenStreetMap tags mean.


@pytest.mark.parametrize(
    "value, expected",
    [
        ("yes", True),
        ("Yes", True),
        ("designated", True),
        ("no", False),
        (None, None),
        # Values that are neither a clear yes nor a clear no are treated
        # as not mapped, not guessed.
        ("limited", None),
        ("customers", None),
        ("", None),
    ],
)
def test_osm_tags_become_true_false_or_unknown(value, expected):
    assert osm_yes_no(value) is expected


def test_a_station_is_called_by_its_name_first():
    assert display_name("BP Clarendon", "BP", "BP Australia") == "BP Clarendon"


def test_a_station_without_a_name_is_called_by_its_brand():
    assert display_name(None, "Shell", None) == "Shell"


def test_then_by_its_operator():
    assert display_name("  ", None, "United Petroleum") == "United Petroleum"


def test_a_station_with_nothing_mapped_still_has_something_to_say():
    assert display_name(None, None, None) == "Fuel station"


# ---- The endpoint.


@pytest.fixture
def client(monkeypatch):
    # No database: startup housekeeping and the connection are replaced.
    monkeypatch.setattr("backend.main.remove_expired", lambda: 0)

    class FakeConnection:
        def close(self):
            pass

    monkeypatch.setattr("backend.main.get_connection", lambda: FakeConnection())
    with TestClient(app) as test_client:
        yield test_client


def test_nearby_stations_are_returned_with_their_tags(client, monkeypatch):
    calls = []

    def fake_find(conn, lon, lat, radius_km, limit):
        calls.append((lon, lat, radius_km, limit))
        return [
            NearbyFuelStation(
                name="BP Clarendon",
                brand="BP",
                lat=-37.83,
                lng=144.95,
                distance_km=1.6,
                diesel=True,
                truck_diesel=None,
                truck_access=None,
                opening_hours="24/7",
            )
        ]

    monkeypatch.setattr("backend.main.find_nearby_fuel_stations", fake_find)
    response = client.post(
        "/journeys/fuel-stations/nearby",
        json={"lat": -37.81, "lng": 144.96, "radius_km": 200, "limit": 20},
    )
    assert response.status_code == 200
    assert calls == [(144.96, -37.81, 200, 20)]
    assert response.json() == [
        {
            "name": "BP Clarendon",
            "brand": "BP",
            "coordinate": {"lat": -37.83, "lng": 144.95},
            "distance_km": 1.6,
            "diesel": True,
            "truck_diesel": None,
            "truck_access": None,
            "opening_hours": "24/7",
        }
    ]


def test_no_stations_nearby_is_an_empty_list_not_an_error(client, monkeypatch):
    monkeypatch.setattr(
        "backend.main.find_nearby_fuel_stations", lambda *args: []
    )
    response = client.post(
        "/journeys/fuel-stations/nearby", json={"lat": -25.0, "lng": 130.0}
    )
    assert response.status_code == 200
    assert response.json() == []


@pytest.mark.parametrize(
    "body",
    [
        {"lat": 999, "lng": 144.96},
        {"lat": -37.81, "lng": 500},
        {"lat": -37.81, "lng": 144.96, "radius_km": 1000},
        {"lat": -37.81, "lng": 144.96, "limit": 500},
        {"lat": -37.81},
    ],
)
def test_impossible_requests_are_refused(client, body):
    assert client.post("/journeys/fuel-stations/nearby", json=body).status_code == 422
