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
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from backend.db import get_connection
from backend.fatigue_rules import UnsupportedJurisdictionError, get_daily_fatigue_rules
from backend.geocoding import search_locations
from backend.rest_plan import generate_rest_plan

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


@app.get("/geocode", response_model=list[GeocodeResultResponse])
def geocode_location(query: str, limit: int = 5) -> list[GeocodeResultResponse]:
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
