# RouteRest API Contract

For the frontend and backend teams. This documents the actual endpoints exposed by `backend/src/backend/main.py`. If this ever looks out of sync with the code, the code wins — update this file to match, not the other way around.

## Base URLs

| Environment | URL |
|---|---|
| Local dev | `http://localhost:8000` (or whatever `NEXT_PUBLIC_API_URL` is set to locally — this session's `.env.local` uses `9000`) |
| Production | `https://api.routerest.app` (verified live, 2026-09-03) |

## General notes

- No authentication — access is restricted by CORS (`ALLOWED_ORIGINS` env var on the backend), not an API key.
- All errors follow FastAPI's default shape: `{"detail": "..."}`.
- All request/response bodies are JSON, `Content-Type: application/json`.
- Coordinates are always `{"lat": float, "lng": float}`.

## Versioning

There is none — this is a single, unversioned API (no `/v1/` prefix, no version header). A breaking change to any endpoint's request or response shape today takes effect immediately for every caller, with no staged rollout or fallback. If either team needs to change a shape in a way the other side isn't ready for, coordinate it directly (e.g. in the team channel) before merging — don't rely on a versioning safety net, because there isn't one. If this becomes a real problem, the usual fix is introducing a `/v1/` prefix and freezing the old paths, but that hasn't been done.

## Rate limits

The backend limits how often one caller may ask, counted per calling address. A caller over a limit gets a `429` with a `Retry-After` header saying how many seconds to wait.

| Endpoint | Per minute | Per day |
|---|---|---|
| `POST /journeys/route` | 20 | 250 |
| `GET /geocode` | 60 | 1500 |
| Everything else | 120 | 10,000 |

Routing is the tightest because it spends an outside allowance shared by every driver: OpenRouteService's free tier caps at **2,000 requests/day account-wide**, and exceeding it surfaces as a `502` here. That allowance was exhausted twice during Iteration 2 testing, which stopped route planning working on the live site until it reset.

`GET /geocode` calls the public `photon.komoot.io` instance, a shared community service with no published hard limit. Search-as-you-type is debounced in the frontend so typing does not fire one request per keystroke.

The other three endpoints only read our own database, so their limit exists to stop a runaway client rather than to protect an allowance.

**Interactive documentation** (`/docs`, `/redoc`, `/openapi.json`) is published only when the `API_DOCS` environment variable is set. The deployed service does not set it, so those paths return `404` in production.

---

## `GET /geocode`

Search for Australian locations by free-text query (Photon geocoding, no key needed).

**Query params**

| Param | Type | Required | Notes |
|---|---|---|---|
| `query` | string | yes | Minimum 3 characters after trimming, or a 400 is returned. |
| `limit` | int | no | Default 5, must be 1–10. |

**Response — `200 OK`**, `list[GeocodeResultResponse]`

```json
[
  {
    "label": "Sydney CBD, NSW 2000, Australia",
    "coordinate": { "lat": -33.8688, "lng": 151.2093 },
    "state": "New South Wales"
  }
]
```

`state` can be `null` — not every geocode result resolves to an Australian state.

**Errors**
- `400` — query is under 3 characters.
- `502` — the upstream geocoding service is unreachable.

---

## `POST /journeys/route`

Fetches a real, road-following HGV route through a list of waypoints (uses OpenRouteService). Waypoints must already be geocoded — this endpoint takes coordinates, not address text; use `GET /geocode` first.

**Request body**

```json
{
  "waypoints": [
    { "lat": -33.8688, "lng": 151.2093 },
    { "lat": -37.8136, "lng": 144.9631 }
  ],
  "height_m": 4.3,
  "weight_kg": 42500
}
```

- `waypoints`: at least 2, in visiting order (first = departure, last = destination, anything between = an intermediate stop).
- `height_m` / `weight_kg`: optional. Defaults to the same conservative HGV assumptions documented on `vehicle_model` in `schema.sql` if the vehicle's real dimensions aren't known.

**Response — `200 OK`**, `RouteResponse`

```json
{
  "distance_km": 864.4547,
  "duration_hours": 13.466138888888889,
  "geometry": [
    { "lat": -33.869024, "lng": 151.209256 },
    { "lat": -33.869081, "lng": 151.209678 }
  ],
  "steps": [
    {
      "instruction": "Head north on George Street",
      "distance_m": 412.3,
      "duration_s": 61.0,
      "start_index": 0,
      "end_index": 9,
      "maneuver_type": 11
    }
  ]
}
```

(Real example: Sydney to Melbourne, verified in production; `steps` trimmed.)

- `steps`: OpenRouteService's turn-by-turn instructions in driving order, flattened across intermediate waypoints. `start_index` / `end_index` are indices into `geometry` (the step spans that slice of the line). Always present, possibly empty. Used by the in-app navigation page; the map and rest plan ignore it.
- Each step's instruction describes the maneuver at its `start_index`. While the vehicle is on step *k*, the next thing the driver has to do is step *k + 1*, which happens where step *k* ends.
- `maneuver_type`: OpenRouteService's code for that maneuver, or `null` when ORS leaves it out. The navigation page uses it to choose the turn arrow.

  | Code | Maneuver | Code | Maneuver |
  |---|---|---|---|
  | 0 | Turn left | 7 | Enter roundabout |
  | 1 | Turn right | 8 | Exit roundabout |
  | 2 | Sharp left | 9 | U-turn |
  | 3 | Sharp right | 10 | Arrive |
  | 4 | Slight left | 11 | Depart |
  | 5 | Slight right | 12 | Keep left |
  | 6 | Straight on | 13 | Keep right |

**Errors**
- `422` — the request is fine, but no legal HGV route exists between these points (e.g. an HGV-restricted network gap).
- `502` — the routing service (or its API key) is unavailable.

---

## `POST /journeys/rest-stops`

Matches each planned rest break to the single **nearest** real rest area along the route. Used for map markers — one result per break, in the same order.

**Request body**

```json
{
  "route_geometry": [
    { "lat": -33.8688, "lng": 151.2093 },
    { "lat": -37.8136, "lng": 144.9631 }
  ],
  "fractions": [0.15, 0.45]
}
```

- `route_geometry`: the same geometry `POST /journeys/route` returned — reuse it, don't refetch.
- `fractions`: one value per break, `0..1`, how far along the route's total driving distance that break falls (elapsed driving time at the break's start ÷ total driving time — an approximation, see `rest_stops.py`).

**Response — `200 OK`**, `list[MatchedRestStopResponse]`, one entry per fraction

```json
[
  {
    "found": true,
    "name": "Gordon VC Rest Area",
    "road_name": "HUME HIGHWAY",
    "coordinate": { "lat": -34.7, "lng": 149.7 },
    "distance_km": 1.2,
    "facilities": ["Toilets", "Bin", "Seating"],
    "interpolated_coordinate": { "lat": -34.701, "lng": 149.702 }
  }
]
```

`found: false` is a valid, correct answer for remote stretches of route with nothing nearby — not an error. `interpolated_coordinate` is **always** present regardless of `found`; use it as the marker position when `found` is `false`, rather than any fixed fallback location.

`name` falls back to `"Rest area on <road_name>"` when the source data has no name but does have a road name (VIC/WA/TAS), or `"Unnamed rest area"` when it has neither (QLD/SA have no name or road name at all in the source data).

---

## `POST /journeys/rest-stops/candidates`

Finds up to `limit` real rest areas near **one point**, closest first — for choosing between alternatives (US 2.2/2.5 ranking), not just taking the single nearest one.

**Request body**

```json
{
  "lat": -34.7516,
  "lng": 149.7209,
  "radius_km": 50,
  "limit": 5
}
```

- `radius_km`: optional, default 50, must be 0–200.
- `limit`: optional, default 5, must be 1–20.

**Response — `200 OK`**, `list[RestStopCandidateResponse]`

```json
[
  {
    "name": "Goulburn South Service Centre",
    "road_name": "COWPER STREET",
    "coordinate": { "lat": -34.77224, "lng": 149.69187 },
    "distance_km": 3.508,
    "facilities": ["Toilets", "Bin", "Fuel"]
  }
]
```

(Real example, verified against production.) An empty list is a valid response — no candidates within radius.

`facilities` including `"Fuel"` only means fuel *might* be available (inferred from the source's `provider_type`, not a confirmed fact), and never distinguishes fuel type — treat any fuel-type matching downstream as Diesel-only (see `rest_stops.py`'s docstring).

---

## `POST /journeys/rest-plan`

Computes the mandatory rest breaks for one journey, given fatigue rules for a jurisdiction.

**Request body**

```json
{
  "departure_time": "2026-09-03T06:00:00",
  "jurisdiction_code": "NSW",
  "configuration": "solo",
  "total_driving_hours": 9.5
}
```

- `jurisdiction_code`: 2–3 characters (e.g. `NSW`, `WA`, `NT`). NHVR Standard Hours are identical across VIC/NSW/QLD/SA/TAS/ACT — WA has its own genuinely different scheme; NT has no rules of its own and borrows the NHVR numbers as an app-level default (not real NT law).
- `configuration`: `"solo"` or `"two_up"` (has a co-driver).
- `total_driving_hours`: must be `> 0` and `<= 336` (14 days), a sanity bound, not a real limit.

**Response — `200 OK`**, `list[RestBreakResponse]`

```json
[
  {
    "start": "2026-09-03T11:30:00",
    "end": "2026-09-03T11:50:00",
    "reason": "Short rest required under the NHVR 5.5-hour rule"
  }
]
```

An empty list is a valid, correct response — the journey is short enough that no rest is legally required.

**Errors**
- `422` — `jurisdiction_code` isn't one this backend has fatigue rules seeded for.

---

## Quick reference table

| Method | Path | Purpose |
|---|---|---|
| GET | `/geocode` | Search for a location by text |
| POST | `/journeys/route` | Real HGV route between waypoints |
| POST | `/journeys/rest-stops` | One nearest rest area per break (map markers) |
| POST | `/journeys/rest-stops/candidates` | Several nearby rest areas, for ranking/choosing |
| POST | `/journeys/rest-plan` | Compute mandatory rest breaks |

Interactive, always-in-sync docs are also available at `https://api.routerest.app/docs` (Swagger UI, auto-generated by FastAPI) — useful for trying requests directly in the browser.
