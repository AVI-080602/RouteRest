"""Remembers routes we have already fetched, so the same journey does not
spend the routing allowance twice.

Why this exists: OpenRouteService gives us 2,000 routes a day, shared by
every driver using RouteRest. That allowance ran out twice during
Iteration 2 and stopped route planning working on the live site, because
planning the same journey again always cost another request. Testing,
demonstrations and a driver pressing Start Journey twice all ask for
routes we already have.

What is stored is deliberately limited. The key is a hash of the rounded
waypoints, so the table cannot be read as a list of where people are
going, nothing records who asked, and rows expire after 30 days. Roads do
change, so a cached route is not kept forever.

Every function here fails quietly: if the cache cannot be read or
written, routing carries on and asks the routing service, because a
missing cache is an inconvenience and a failed journey plan is not.
"""

import hashlib
import json
import logging
from datetime import timedelta

from backend.db import get_connection
from backend.routing import RouteResult, RouteStep

logger = logging.getLogger(__name__)

# Roads change, and a route calculated last month may no longer be the
# best one, so entries are used for this long and then fetched again.
MAX_AGE = timedelta(days=30)

# Coordinates are rounded before hashing, so that two requests for the
# same journey match even when a coordinate differs in the last decimal
# place. Five decimal places is about a metre, which is far finer than
# anything that would change a truck route.
COORDINATE_PLACES = 5


def cache_key(
    waypoints: list[tuple[float, float]], height_m: float, weight_kg: float
) -> str:
    """The key for one route request.

    Height and weight are part of the key because they change the route: a
    taller or heavier truck is sent a different way, so a cached route from
    a smaller vehicle must never be handed to a larger one.
    """
    rounded = [
        (round(lon, COORDINATE_PLACES), round(lat, COORDINATE_PLACES))
        for lon, lat in waypoints
    ]
    material = json.dumps(
        {"waypoints": rounded, "height_m": height_m, "weight_kg": weight_kg},
        separators=(",", ":"),
    )
    return hashlib.sha256(material.encode()).hexdigest()


def get_cached_route(key: str) -> RouteResult | None:
    """The stored route for this key, or None when there is none, it has
    expired, or the cache cannot be read."""
    try:
        conn = get_connection()
    except Exception:
        logger.warning("Route cache unavailable for reading", exc_info=True)
        return None

    try:
        with conn, conn.cursor() as cursor:
            cursor.execute(
                """
                SELECT distance_km, duration_hours, geometry, steps
                FROM route_cache
                WHERE cache_key = %(key)s
                  AND created_at > now() - %(max_age)s::interval
                """,
                {"key": key, "max_age": f"{MAX_AGE.days} days"},
            )
            row = cursor.fetchone()
            if row is None:
                return None

            distance_km, duration_hours, geometry, steps = row
            cursor.execute(
                """
                UPDATE route_cache
                SET last_used_at = now(), use_count = use_count + 1
                WHERE cache_key = %(key)s
                """,
                {"key": key},
            )
    except Exception:
        logger.warning("Route cache read failed", exc_info=True)
        return None
    finally:
        conn.close()

    return RouteResult(
        distance_km=float(distance_km),
        duration_hours=float(duration_hours),
        geometry=[(point[0], point[1]) for point in geometry],
        steps=[RouteStep(**step) for step in steps],
    )


def store_route(key: str, result: RouteResult) -> None:
    """Keeps a fetched route for next time. Failure is ignored: the caller
    already has its answer, and losing a cache entry costs one request."""
    try:
        conn = get_connection()
    except Exception:
        logger.warning("Route cache unavailable for writing", exc_info=True)
        return

    try:
        with conn, conn.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO route_cache
                    (cache_key, distance_km, duration_hours, geometry, steps)
                VALUES
                    (%(key)s, %(distance)s, %(duration)s, %(geometry)s, %(steps)s)
                ON CONFLICT (cache_key) DO UPDATE
                SET distance_km = EXCLUDED.distance_km,
                    duration_hours = EXCLUDED.duration_hours,
                    geometry = EXCLUDED.geometry,
                    steps = EXCLUDED.steps,
                    created_at = now(),
                    last_used_at = now()
                """,
                {
                    "key": key,
                    "distance": result.distance_km,
                    "duration": result.duration_hours,
                    "geometry": json.dumps([[lon, lat] for lon, lat in result.geometry]),
                    "steps": json.dumps(
                        [
                            {
                                "instruction": step.instruction,
                                "distance_m": step.distance_m,
                                "duration_s": step.duration_s,
                                "start_index": step.start_index,
                                "end_index": step.end_index,
                                "maneuver_type": step.maneuver_type,
                            }
                            for step in result.steps
                        ]
                    ),
                },
            )
    except Exception:
        logger.warning("Route cache write failed", exc_info=True)
    finally:
        conn.close()


def remove_expired() -> int:
    """Deletes entries past their age. Returns how many were removed."""
    try:
        conn = get_connection()
    except Exception:
        logger.warning("Route cache unavailable for cleaning", exc_info=True)
        return 0

    try:
        with conn, conn.cursor() as cursor:
            cursor.execute(
                "DELETE FROM route_cache WHERE created_at <= now() - %(max_age)s::interval",
                {"max_age": f"{MAX_AGE.days} days"},
            )
            return cursor.rowcount
    except Exception:
        logger.warning("Route cache clean failed", exc_info=True)
        return 0
    finally:
        conn.close()
