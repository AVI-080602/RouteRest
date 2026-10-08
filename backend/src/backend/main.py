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
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Literal

import requests
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from backend.db import get_connection
from backend.http_guards import (
    RateLimitMiddleware,
    SecurityHeadersMiddleware,
    api_docs_enabled,
)
from backend.fatigue_rules import UnsupportedJurisdictionError, get_daily_fatigue_rules
from backend.geocoding import search_locations
from backend.rest_plan import generate_rest_plan
from backend.route_cache import cache_key, get_cached_route, remove_expired, store_route
from backend.rest_stops import (
    find_nearby_rest_areas,
    find_nearest_rest_area,
    interpolate_point_along_route,
)
from backend.routing import (
    DEFAULT_HEIGHT_M,
    DEFAULT_WEIGHT_KG,
    RouteNotFoundError,
    RoutingUnavailableError,
    get_api_key,
    get_hgv_route,
)

from backend.journey_performance import JourneyPerformanceRequest
from backend.journey_scoring import (
    calculate_journey_score,
    update_overall_rating,
)

# The interactive documentation lists every request and field. That is
# useful while developing and an open invitation on a public server, so it
# is published only when API_DOCS is set (security testing finding S2).
@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Drops cached routes past their age when the service starts.

    A deployment restarts the service, so this runs often enough to keep
    the table from growing without a scheduled job. Cleaning never fails
    startup: a cache that cannot be cleaned still works.
    """
    removed = remove_expired()
    if removed:
        print(f"[route cache] removed {removed} expired route(s)")
    yield


_docs = api_docs_enabled()
app = FastAPI(
    lifespan=lifespan,
    title="RouteRest API",
    docs_url="/docs" if _docs else None,
    redoc_url="/redoc" if _docs else None,
    openapi_url="/openapi.json" if _docs else None,
)

allowed_origins = os.environ.get("ALLOWED_ORIGINS", "http://localhost:3000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)
# Added after CORS on purpose: middleware runs in reverse order of
# addition, so a refused request still comes back with the CORS headers the
# browser needs to show our own error message rather than a network error.
app.add_middleware(RateLimitMiddleware)
app.add_middleware(SecurityHeadersMiddleware)


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
    """A map coordinate in the same shape the Next.js frontend uses.

    The ranges are the real limits of latitude and longitude, so a value
    outside them is refused rather than searched for (security testing,
    out of range values)."""

    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)


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

    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)


class RouteRequest(BaseModel):
    """What the frontend sends to ask for a real driven route. height_m
    and weight_kg are optional, if the selected vehicle's real dimensions
    are not known, routing falls back to the same conservative default
    documented on vehicle_model in schema.sql."""

    waypoints: list[RouteWaypoint] = Field(min_length=2)
    height_m: float = Field(default=DEFAULT_HEIGHT_M, gt=0)
    weight_kg: float = Field(default=DEFAULT_WEIGHT_KG, gt=0)


class RouteStepResponse(BaseModel):
    """One turn instruction, e.g. "Turn right onto Hume Highway".
    start_index/end_index are indices into RouteResponse.geometry (the
    step spans that slice of the line), so the navigation page can pick
    the instruction that applies to wherever the vehicle currently is."""

    instruction: str
    distance_m: float
    duration_s: float
    start_index: int
    end_index: int
    # ORS maneuver code (0 left, 1 right, 7 roundabout, 10 arrive, ...),
    # used by the navigation page for the turn arrow. Optional so a step
    # without one still validates.
    maneuver_type: int | None = None


class RouteResponse(BaseModel):
    """A real, road-following route: total distance/duration, the
    geometry to draw on a map, and turn-by-turn steps for in-app
    navigation. steps is empty (never missing) when the routing service
    returned none, so clients can always iterate it."""

    distance_km: float
    duration_hours: float
    geometry: list[CoordinateResponse]
    steps: list[RouteStepResponse] = []


@app.post("/journeys/route", response_model=RouteResponse)
def create_route(request: RouteRequest) -> RouteResponse:
    """Fetches a real HGV-legal route through the given waypoints (US 1.3,
    AC 1.3.5's map). Waypoints must already be geocoded, see GET /geocode,
    this endpoint does not turn address text into coordinates itself."""
    waypoints = [(w.lng, w.lat) for w in request.waypoints]

    # A route we already have costs nothing. The routing service gives us
    # 2,000 a day shared by every driver, and planning the same journey
    # twice used to spend two of them (see route_cache.py).
    key = cache_key(waypoints, request.height_m, request.weight_kg)
    cached = get_cached_route(key)
    if cached is not None:
        return _route_response(cached)

    try:
        api_key = get_api_key()
        result = get_hgv_route(
            waypoints=waypoints,
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

    store_route(key, result)
    return _route_response(result)


def _route_response(result) -> RouteResponse:
    """The wire shape of a route, whether it came from the routing service
    or from our own cache, so both answers are identical."""
    return RouteResponse(
        distance_km=result.distance_km,
        duration_hours=result.duration_hours,
        geometry=[CoordinateResponse(lat=lat, lng=lon) for lon, lat in result.geometry],
        steps=[
            RouteStepResponse(
                instruction=step.instruction,
                distance_m=step.distance_m,
                duration_s=step.duration_s,
                start_index=step.start_index,
                end_index=step.end_index,
                maneuver_type=step.maneuver_type,
            )
            for step in result.steps
        ],
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
    correct answer for remote stretches of route, not an error.
    interpolated_coordinate is always present regardless of found, the
    actual point on the real route this break falls at, callers should
    use it as the marker position when found is False, rather than any
    fixed fallback location, a break with no confirmed real rest area
    nearby should still show up in the right place along the route, not
    jump to an unrelated fixed spot."""

    found: bool
    name: str | None = None
    road_name: str | None = None
    coordinate: CoordinateResponse | None = None
    distance_km: float | None = None
    facilities: list[str] = []
    interpolated_coordinate: CoordinateResponse


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
            interpolated = CoordinateResponse(lat=lat, lng=lon)
            match = find_nearest_rest_area(conn, lon, lat)
            if match is None:
                results.append(
                    MatchedRestStopResponse(
                        found=False, interpolated_coordinate=interpolated
                    )
                )
                continue
            results.append(
                MatchedRestStopResponse(
                    found=True,
                    name=match.name,
                    road_name=match.road_name,
                    coordinate=CoordinateResponse(lat=match.lat, lng=match.lng),
                    distance_km=match.distance_km,
                    facilities=match.facilities,
                    interpolated_coordinate=interpolated,
                )
            )
        return results
    finally:
        conn.close()


class RestStopCandidatesRequest(BaseModel):
    """What the frontend sends to ask for SEVERAL nearby rest areas
    around one point (US 2.2/2.5, choosing between alternatives),
    unlike /journeys/rest-stops which only ever returns the single
    closest match per break, for map markers."""

    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    radius_km: float = Field(default=50, gt=0, le=200)
    limit: int = Field(default=5, gt=0, le=20)


class RestStopCandidateResponse(BaseModel):
    """One candidate rest area, closest first."""

    name: str
    road_name: str | None = None
    coordinate: CoordinateResponse
    distance_km: float
    facilities: list[str] = []


@app.post("/journeys/rest-stops/candidates", response_model=list[RestStopCandidateResponse])
def get_rest_stop_candidates(
    request: RestStopCandidatesRequest,
) -> list[RestStopCandidateResponse]:
    """Finds up to `limit` real rest areas near one point, closest
    first (US 2.2/2.5): the frontend ranks these against the driver's
    actual needs (rankStops/updateStopRecommendations) rather than
    always taking the single nearest one."""
    conn = get_connection()
    try:
        matches = find_nearby_rest_areas(
            conn, request.lng, request.lat, request.radius_km, request.limit
        )
        return [
            RestStopCandidateResponse(
                name=match.name,
                road_name=match.road_name,
                coordinate=CoordinateResponse(lat=match.lat, lng=match.lng),
                distance_km=match.distance_km,
                facilities=match.facilities,
            )
            for match in matches
        ]
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

@app.post("/journeys/performance/evaluate", tags=["Performance"])
def evaluate_performance(request: JourneyPerformanceRequest) -> dict:
    """Calculate journey and overall ratings without storing data."""
    # Historical totals must be consistent, even when journey data is missing.
    if request.previous_total > 100 * request.previous_count:
        raise HTTPException(
            status_code=422,
            detail="Previous total is inconsistent with journey count.",
        )

    # Convert request models into the scoring function's tuple format.
    rests = [
        (rest.required_minutes, rest.actual_minutes)
        for rest in request.rests
    ]

    try:
        journey = calculate_journey_score(
            rests=rests,
            checks=request.checks,
        )

        # Incomplete data must not change the cumulative rating.
        overall = None
        if journey["status"] == "scored":
            overall = update_overall_rating(
                previous_total=request.previous_total,
                previous_count=request.previous_count,
                journey_score=journey["journey_score"],
            )
    except ValueError as error:
        raise HTTPException(
            status_code=422,
            detail=str(error),
        ) from error

    return {
        "journey_id": str(request.journey_id),
        "journey": journey,
        "overall": overall,
    }