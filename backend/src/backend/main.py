"""The RouteRest API.

What this file is for: the FastAPI application itself, wiring HTTP
endpoints to the actual logic in rest_plan.py and fatigue_rules.py. Run
locally with:

    uv run fastapi dev src/backend/main.py

CORS origins come from the ALLOWED_ORIGINS environment variable (comma
separated), defaulting to just the local Next.js dev server so local
development works unconfigured. In production this must be set to the
real deployed frontend's origin, e.g. https://app.example.com, a blank
default of "*" would let any website's JavaScript call this API.
"""

import os
from datetime import datetime
from typing import Literal

import requests
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from backend.db import get_connection
from backend.fatigue_rules import UnsupportedJurisdictionError, get_daily_fatigue_rules
from backend.geocoding import search_locations
from backend.rest_plan import generate_rest_plan
from backend.rest_stops import find_nearest_rest_area, interpolate_point_along_route
from backend.routing import (
    DEFAULT_HEIGHT_M,
    DEFAULT_WEIGHT_KG,
    RouteNotFoundError,
    RoutingUnavailableError,
    get_api_key,
    get_hgv_route,
)

app = FastAPI(title="RouteRest API")

allowed_origins = os.environ.get("ALLOWED_ORIGINS", "http://localhost:3000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


class RestPlanRequest(BaseModel):
    """What the frontend sends to ask for a rest plan. total_driving_hours
    is supplied by the caller rather than computed here, this endpoint
    only knows fatigue rules, not routing, see the note in rest_plan.py
    about this module's deliberate scope."""

    departure_time: datetime
    jurisdiction_code: str = Field(min_length=2, max_length=3, examples=["VIC"])
    configuration: Literal["solo", "two_up"]
    total_driving_hours: float = Field(gt=0, le=24 * 14)  # an upper bound generous enough for any real journey, just a sanity check, not a real limit


class RestBreakResponse(BaseModel):
    """One rest break, shaped for JSON: RestBreak from rest_plan.py uses
    datetime objects internally, this is the wire format the frontend
    actually receives."""

    start: datetime
    end: datetime
    reason: str


class CoordinateResponse(BaseModel):
    """A map coordinate in the same shape the Next.js frontend uses."""

    lat: float
    lng: float


class GeocodeResultResponse(BaseModel):
    """One location suggestion returned by the geocoding endpoint."""

    label: str
    coordinate: CoordinateResponse
    state: str | None = None


@app.get("/geocode", response_model=list[GeocodeResultResponse])
def geocode_location(
    query: str, limit: int = Query(default=5, gt=0, le=10)
) -> list[GeocodeResultResponse]:
    """Search Photon for Australian locations matching the user's text."""
    clean_query = query.strip()

    if len(clean_query) < 3:
        raise HTTPException(
            status_code=400,
            detail="Query must be at least 3 characters long.",
        )

    try:
        return search_locations(query=clean_query, limit=limit)
    except requests.RequestException as error:
        raise HTTPException(
            status_code=502,
            detail="Geocoding service is currently unavailable.",
        ) from error


class RouteWaypoint(BaseModel):
    """One stop along the route, in the order the vehicle visits it. The
    first is the departure point, the last is the final destination,
    anything between is an intermediate stop."""

    lat: float
    lng: float


class RouteRequest(BaseModel):
    """What the frontend sends to ask for a real driven route. height_m
    and weight_kg are optional, if the selected vehicle's real dimensions
    are not known, routing falls back to the same conservative default
    documented on vehicle_model in schema.sql."""

    waypoints: list[RouteWaypoint] = Field(min_length=2)
    height_m: float = Field(default=DEFAULT_HEIGHT_M, gt=0)
    weight_kg: float = Field(default=DEFAULT_WEIGHT_KG, gt=0)


class RouteResponse(BaseModel):
    """A real, road-following route: total distance/duration and the
    geometry to draw on a map."""

    distance_km: float
    duration_hours: float
    geometry: list[CoordinateResponse]


@app.post("/journeys/route", response_model=RouteResponse)
def create_route(request: RouteRequest) -> RouteResponse:
    """Fetches a real HGV-legal route through the given waypoints (US 1.3,
    AC 1.3.5's map). Waypoints must already be geocoded, see GET /geocode,
    this endpoint does not turn address text into coordinates itself."""
    try:
        api_key = get_api_key()
        result = get_hgv_route(
            waypoints=[(w.lng, w.lat) for w in request.waypoints],
            api_key=api_key,
            height_m=request.height_m,
            weight_kg=request.weight_kg,
        )
    except RouteNotFoundError as error:
        # A 422 (unprocessable): the request itself is fine, there is
        # just no legal route for this vehicle between these points.
        raise HTTPException(status_code=422, detail=str(error)) from error
    except RoutingUnavailableError as error:
        # A 502: the request was fine, the upstream routing service (or
        # its API key) is the problem, not anything the caller did.
        raise HTTPException(status_code=502, detail=str(error)) from error

    return RouteResponse(
        distance_km=result.distance_km,
        duration_hours=result.duration_hours,
        geometry=[CoordinateResponse(lat=lat, lng=lon) for lon, lat in result.geometry],
    )


class RestStopRequest(BaseModel):
    """What the frontend sends to match each rest break to a real,
    nearby rest area. route_geometry is the same geometry POST
    /journeys/route already returned, reused rather than re-fetched.
    fractions is one 0..1 value per break, how far along the route's
    total driving distance that break falls (elapsed driving time at
    the break's start, divided by total driving time, an approximation
    documented in rest_stops.py)."""

    route_geometry: list[CoordinateResponse] = Field(min_length=2)
    fractions: list[float] = Field(min_length=1)


class MatchedRestStopResponse(BaseModel):
    """A real rest area matched to one break, or found=False when
    nothing suitable exists within the search radius, a genuinely
    correct answer for remote stretches of route, not an error."""

    found: bool
    name: str | None = None
    road_name: str | None = None
    coordinate: CoordinateResponse | None = None
    distance_km: float | None = None
    facilities: list[str] = []


@app.post("/journeys/rest-stops", response_model=list[MatchedRestStopResponse])
def match_rest_stops(request: RestStopRequest) -> list[MatchedRestStopResponse]:
    """Finds a real rest area near each break's position along the
    route (US 1.3, replacing the old hardcoded 2-location mock cycling
    with the actual 5,000+ row rest_area table)."""
    geometry = [(point.lng, point.lat) for point in request.route_geometry]

    conn = get_connection()
    try:
        results: list[MatchedRestStopResponse] = []
        for fraction in request.fractions:
            lon, lat = interpolate_point_along_route(geometry, fraction)
            match = find_nearest_rest_area(conn, lon, lat)
            if match is None:
                results.append(MatchedRestStopResponse(found=False))
                continue
            results.append(
                MatchedRestStopResponse(
                    found=True,
                    name=match.name,
                    road_name=match.road_name,
                    coordinate=CoordinateResponse(lat=match.lat, lng=match.lng),
                    distance_km=match.distance_km,
                    facilities=match.facilities,
                )
            )
        return results
    finally:
        conn.close()


@app.post("/journeys/rest-plan", response_model=list[RestBreakResponse])
def create_rest_plan(request: RestPlanRequest) -> list[RestBreakResponse]:
    """Computes and returns the rest breaks required for one journey (US 1.3).

    An empty list is a valid, correct response, meaning the journey is
    short enough that no rest is legally required, not a failure.
    """
    conn = get_connection()
    try:
        short_breaks, major_rest = get_daily_fatigue_rules(
            conn, request.jurisdiction_code, request.configuration
        )
    except UnsupportedJurisdictionError as error:
        # A 422 (unprocessable), not a 500: the request itself is fine,
        # it is asking about a jurisdiction we cannot legally answer for.
        raise HTTPException(status_code=422, detail=str(error)) from error
    finally:
        conn.close()

    breaks = generate_rest_plan(
        short_breaks,
        major_rest,
        request.departure_time,
        total_driving_minutes=request.total_driving_hours * 60,
    )

    return [
        RestBreakResponse(start=b.start, end=b.end, reason=b.reason)
        for b in breaks
    ]
