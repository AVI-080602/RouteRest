"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Navigation, Route, ShieldCheck, UserRound } from "lucide-react";
import RouteMap from "@/components/RouteMap";
import { JourneyDetails, RestBreak } from "@/types/journeyDetails";
import { PlannedSafeStop, RouteBreaksData } from "@/types/routeBreaks";
import { RankedStop, rankStops } from "@/utils/rankStops";
import {
  buildJourneyNeeds,
  getStopUnsuitableReasons,
  hasRelevantJourneyChange,
} from "@/utils/updateStopRecommendations";

const LOCAL_STORAGE_KEY = "currentJourneyDetails";
const REST_PLAN_STORAGE_KEY = "currentRestPlan";
const STOP_OVERRIDES_STORAGE_KEY = "currentStopOverrides";

// Turns a candidate's distance off-route into an estimated extra minutes
// figure for rankStops' proximity-to-rest-time rule. Not a real routed
// detour time (that would need its own routing call per candidate), just
// enough resolution for ranking, not for display.
const ASSUMED_DETOUR_SPEED_KMH = 60;

// rankStops.ts's RankedStop has no coordinate (it only knows about
// scoring), but picking a candidate needs to move the map marker, so
// this page carries the coordinate alongside it locally rather than
// changing the shared US 2.2 type.
type RankedCandidate = RankedStop & {
  coordinate: { lat: number; lng: number };
};

type StopOverride = {
  stop: RankedCandidate;
  // journeyDetails at the moment this stop was picked, compared against
  // the current journeyDetails to detect when the pick should be
  // re-checked (US 2.5), see getStopWarning below.
  journeySnapshot: JourneyDetails;
};

// Same fallback pattern as newjourney/page.tsx, so this page works
// unconfigured against a local backend too.
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type RealRoute = {
  distanceKm: number;
  durationHours: number;
  geometry: { lat: number; lng: number }[];
};

// One per break, in the same order, from POST /journeys/rest-stops.
// found=false is a real, valid answer (no real rest area within range
// of that break's position), not a request failure.
type MatchedRestStop = {
  found: boolean;
  name?: string;
  coordinate?: { lat: number; lng: number };
  facilities?: string[];
  // Always present regardless of found, the actual point on the real
  // route this break falls at. Used as the marker position when found
  // is false, so a break with no confirmed real rest area nearby still
  // shows up in the right place along the route, instead of jumping to
  // an unrelated fixed mock location (a real bug this fixed: 2 of 4
  // stops on an unrelated route were landing on Goulburn/Pheasants Nest,
  // the mock stand-ins, hundreds of km from the actual route).
  interpolatedCoordinate: { lat: number; lng: number };
};

function subscribeToJourneyStorage(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  return () => window.removeEventListener("storage", onStoreChange);
}

function getSavedJourneySnapshot() {
  return localStorage.getItem(LOCAL_STORAGE_KEY);
}

function getSavedRestPlanSnapshot() {
  return localStorage.getItem(REST_PLAN_STORAGE_KEY);
}

function getServerJourneySnapshot() {
  return null;
}

const fallbackRestBreaks: RestBreak[] = [
  {
    start: "2026-09-01T11:15:00",
    end: "2026-09-01T11:30:00",
    reason: "Short rest required under the NHVR 5.5-hour rule",
  },
  {
    start: "2026-09-01T13:40:00",
    end: "2026-09-01T14:10:00",
    reason: "Major rest required under the NHVR 24-hour rule",
  },
];

const mockRouteBreaksData: RouteBreaksData = {
  // Temporary route shape for the map preview. This will be replaced by
  // OpenRouteService geometry once real routing is connected.
  routeGeometry: [
    { lat: -37.8136, lng: 144.9631 },
    { lat: -36.758, lng: 144.28 },
    { lat: -35.2809, lng: 149.13 },
    { lat: -33.8688, lng: 151.2093 },
  ],
  destinations: [
    {
      label: "Canberra City, ACT 2601, Australia",
      coordinate: { lat: -35.2809, lng: 149.13 },
    },
    {
      label: "Sydney CBD, NSW 2000, Australia",
      coordinate: { lat: -33.8688, lng: 151.2093 },
    },
  ],
  restStops: [
    {
      id: "stop-1",
      name: "Goulburn Heavy Vehicle Rest Area",
      coordinate: { lat: -34.7516, lng: 149.7209 },
      distanceKm: 214,
      estimatedArrivalTime: "11:15 AM",
      facilities: ["Toilets", "Lighting", "Heavy vehicle parking"],
      restBreak: fallbackRestBreaks[0],
      isDriverSwitchLocation: false,
    },
    {
      id: "stop-2",
      name: "Pheasants Nest Service Centre",
      coordinate: { lat: -34.2558, lng: 150.6408 },
      distanceKm: 312,
      estimatedArrivalTime: "1:40 PM",
      facilities: ["Fuel", "Food", "Lighting", "Rest area"],
      restBreak: fallbackRestBreaks[1],
      isDriverSwitchLocation: true,
    },
  ],
  currentEta: "4:30 PM",
  currentActiveDriver: "Primary Driver",
};

// Includes the date, not just the time: a multi-day plan (very ordinary,
// see US 1.3's own tests) can have a break at, say, "1:33 am" that is
// actually the NEXT calendar day relative to an earlier "5:48 pm" break,
// time-only formatting made that genuinely ambiguous.
const DATE_TIME_FORMAT = new Intl.DateTimeFormat("en-AU", {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
});

function formatBreakDateTime(value: string) {
  return DATE_TIME_FORMAT.format(new Date(value));
}

function parseDepartureDateTime(details: JourneyDetails): Date | null {
  if (!details.departureDate || !details.departureTime) {
    return null;
  }
  return new Date(`${details.departureDate}T${details.departureTime}:00`);
}

/** How far along the route's total DRIVING distance (0..1) each break
 * falls, from the elapsed driving time (wall-clock time since departure
 * minus every earlier break's own duration) at the moment it starts.
 * An approximation (assumes roughly uniform average speed along the
 * route), documented in backend/src/backend/rest_stops.py where it is
 * actually used to pick a real nearby rest area. */
function computeBreakFractions(
  breaks: RestBreak[],
  departure: Date,
  totalDrivingMinutes: number,
): number[] {
  let cumulativeRestMs = 0;
  return breaks.map((restBreak) => {
    const breakStartMs = new Date(restBreak.start).getTime();
    const elapsedWallClockMs = breakStartMs - departure.getTime();
    const elapsedDrivingMinutes = (elapsedWallClockMs - cumulativeRestMs) / 60000;
    cumulativeRestMs +=
      new Date(restBreak.end).getTime() - new Date(restBreak.start).getTime();
    return totalDrivingMinutes > 0
      ? elapsedDrivingMinutes / totalDrivingMinutes
      : 0;
  });
}

// Converts one POST /journeys/rest-stops/candidates result into the
// RankedStop shape rankStops needs. The candidates endpoint only ever
// returns heavy_vehicle_area=TRUE rows (see rest_stops.py), so every
// candidate here is already heavy-vehicle suitable; hasHeavyVehicleParking
// mirrors that same flag, there is no separate parking-specific column in
// the source data. fuelTypes is a best-effort guess: has_fuel_derived only
// means fuel MIGHT be available (inferred from provider_type, not a real
// fuel-type field), Diesel is the closest honest guess since NFDH service
// centres are overwhelmingly diesel, not EV charging.
function candidateToRankedStop(
  candidate: {
    name: string;
    coordinate: { lat: number; lng: number };
    distance_km: number;
    facilities: string[];
  },
  index: number,
): RankedCandidate {
  return {
    id: `candidate-${index}-${candidate.name}`,
    name: candidate.name,
    score: 0,
    rankingReasons: [],
    isHeavyVehicleSuitable: true,
    hasLighting: candidate.facilities.includes("Lighting"),
    hasHeavyVehicleParking: true,
    fuelTypes: candidate.facilities.includes("Fuel") ? ["Diesel"] : [],
    minutesFromRecommendedRest: Math.round(
      (candidate.distance_km / ASSUMED_DETOUR_SPEED_KMH) * 60,
    ),
    detourDistanceKm: candidate.distance_km,
    facilities: candidate.facilities,
    coordinate: candidate.coordinate,
  };
}

// The same conversion as candidateToRankedStop, but for a stop already
// on the plan (the backend's own nearest match, not a fetched
// candidate). Needed because suitability checking must cover EVERY
// planned stop, not just ones the driver explicitly picked from
// alternatives, the nearest-match endpoint never considered fuel or
// rest-timing suitability in the first place, only distance.
function stopToRankedCandidate(stop: PlannedSafeStop): RankedCandidate {
  return {
    id: stop.id,
    name: stop.name,
    score: 0,
    rankingReasons: [],
    isHeavyVehicleSuitable: true,
    hasLighting: stop.facilities.includes("Lighting"),
    hasHeavyVehicleParking: true,
    fuelTypes: stop.facilities.includes("Fuel") ? ["Diesel"] : [],
    minutesFromRecommendedRest: 0,
    detourDistanceKm: 0,
    facilities: stop.facilities,
    coordinate: stop.coordinate,
  };
}

function isNightTimeBreak(restBreak: RestBreak): boolean {
  const hour = new Date(restBreak.start).getHours();
  return hour < 6 || hour >= 20;
}

function buildPlannedStops(
  restPlan: RestBreak[],
  hasCoDriver: boolean,
): PlannedSafeStop[] {
  const stopTemplates = mockRouteBreaksData.restStops;

  // This is the bridge between US1.3 and Route & Breaks: the backend tells
  // us when rest is required, while the future stop API will choose where.
  return restPlan.map((restBreak, index) => {
    const template = stopTemplates[index % stopTemplates.length];

    return {
      ...template,
      id: `${template.id}-${index}`,
      estimatedArrivalTime: formatBreakDateTime(restBreak.start),
      restBreak,
      // A switch only makes sense when there is a second driver to switch
      // to; template.isDriverSwitchLocation is just which mock location
      // slot this happened to land on and previously showed "Switch" on
      // solo journeys too, this hasCoDriver check is the actual fix.
      isDriverSwitchLocation:
        hasCoDriver &&
        restBreak.reason.toLowerCase().includes("major rest") &&
        template.isDriverSwitchLocation,
    };
  });
}

export default function RouteBreaksPage() {
  // useSyncExternalStore keeps the server render and the first browser
  // render aligned, then reads localStorage after hydration.
  const savedJourney = useSyncExternalStore(
    subscribeToJourneyStorage,
    getSavedJourneySnapshot,
    getServerJourneySnapshot,
  );
  const savedRestPlan = useSyncExternalStore(
    subscribeToJourneyStorage,
    getSavedRestPlanSnapshot,
    getServerJourneySnapshot,
  );

  // Parsed from localStorage, and memoized on the raw string (not
  // recomputed into a new object every render). RouteMap's effect
  // re-initializes the whole MapLibre map whenever the object it
  // receives changes identity, so an unmemoized JSON.parse() here would
  // rebuild the map (losing pan/zoom, refetching tiles) on every
  // unrelated re-render of this page, not just when the journey actually
  // changes.
  const journeyDetails: JourneyDetails | null = useMemo(
    () => (savedJourney ? JSON.parse(savedJourney) : null),
    [savedJourney],
  );
  const restPlan: RestBreak[] = useMemo(
    () => (savedRestPlan ? JSON.parse(savedRestPlan) : []),
    [savedRestPlan],
  );

  // The mock-cycling fallback stops (2 hardcoded locations), used
  // whenever a real match isn't available for a given break, either
  // because there's no real route yet, or the rest-stops match request
  // failed, or that specific break had no real rest area within range.
  const basePlannedStops = useMemo(
    () =>
      restPlan.length > 0
        ? buildPlannedStops(restPlan, journeyDetails?.hasCoDriver ?? false)
        : mockRouteBreaksData.restStops,
    [restPlan, journeyDetails],
  );

  // Only true once the driver actually picked real geocode suggestions
  // for departure and every destination (see the lat/lng comments on
  // JourneyDetails/Destination), free-text entries never get a real
  // route, they fall back to the mock preview below instead of a
  // misleading route between the wrong points.
  const hasResolvedCoordinates =
    journeyDetails !== null &&
    journeyDetails.departureCoordinate !== null &&
    journeyDetails.destination.length > 0 &&
    journeyDetails.destination.every(
      (destination) =>
        destination.lat !== undefined && destination.lng !== undefined,
    );

  const [realRoute, setRealRoute] = useState<RealRoute | null>(null);
  const [routeFetchError, setRouteFetchError] = useState("");
  const [isFetchingRoute, setIsFetchingRoute] = useState(false);

  useEffect(() => {
    if (!hasResolvedCoordinates || !journeyDetails) {
      return;
    }

    const controller = new AbortController();

    (async () => {
      // Set inside the async callback, not synchronously in the effect
      // body, calling setState synchronously during the effect phase
      // triggers an extra same-tick render; here it's a normal
      // async-update-arrived state change instead.
      setIsFetchingRoute(true);
      setRouteFetchError("");

      try {
        const waypoints = [
          journeyDetails.departureCoordinate,
          ...journeyDetails.destination.map((destination) => ({
            lat: destination.lat as number,
            lng: destination.lng as number,
          })),
        ];

        const response = await fetch(`${API_BASE_URL}/journeys/route`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ waypoints }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const body = await response.json().catch(() => null);
          setRealRoute(null);
          setRouteFetchError(
            body?.detail ?? "Could not compute a real route for this journey.",
          );
          return;
        }

        const data: {
          distance_km: number;
          duration_hours: number;
          geometry: { lat: number; lng: number }[];
        } = await response.json();

        setRealRoute({
          distanceKm: data.distance_km,
          durationHours: data.duration_hours,
          geometry: data.geometry,
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setRealRoute(null);
        setRouteFetchError("Could not reach the routing service.");
      } finally {
        if (!controller.signal.aborted) {
          setIsFetchingRoute(false);
        }
      }
    })();

    return () => controller.abort();
  }, [hasResolvedCoordinates, journeyDetails]);

  const [matchedRestStops, setMatchedRestStops] = useState<
    MatchedRestStop[] | null
  >(null);

  // Once a real route AND a real rest plan both exist, ask the backend
  // for an actual nearby rest area for each break (US 1.3, replacing
  // the old 2-location mock cycling with the real ~5,000-row rest_area
  // table). Silent failure on purpose here, same reasoning as the
  // driving-hours auto-fill on newjourney/page.tsx: this is a
  // convenience upgrade over the mock stand-ins, not a required step,
  // basePlannedStops above already has something reasonable to show.
  useEffect(() => {
    const controller = new AbortController();

    (async () => {
      if (!realRoute || restPlan.length === 0 || !journeyDetails) {
        setMatchedRestStops(null);
        return;
      }

      const departure = parseDepartureDateTime(journeyDetails);
      if (!departure) {
        setMatchedRestStops(null);
        return;
      }

      const fractions = computeBreakFractions(
        restPlan,
        departure,
        realRoute.durationHours * 60,
      );

      try {
        const response = await fetch(`${API_BASE_URL}/journeys/rest-stops`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            route_geometry: realRoute.geometry,
            fractions,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          setMatchedRestStops(null);
          return;
        }

        const data: Array<{
          found: boolean;
          name?: string;
          coordinate?: { lat: number; lng: number };
          facilities?: string[];
          interpolated_coordinate: { lat: number; lng: number };
        }> = await response.json();

        setMatchedRestStops(
          data.map((item) => ({
            found: item.found,
            name: item.name,
            coordinate: item.coordinate,
            facilities: item.facilities,
            interpolatedCoordinate: item.interpolated_coordinate,
          })),
        );
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setMatchedRestStops(null);
      }
    })();

    return () => controller.abort();
  }, [realRoute, restPlan, journeyDetails]);

  // The final stops shown: a real matched rest area where one was
  // found, the mock stand-in for that specific break otherwise (never
  // all-or-nothing, a break with no real match nearby still shows
  // something rather than nothing).
  const plannedStops = useMemo(() => {
    if (!matchedRestStops || !realRoute || !journeyDetails) {
      return basePlannedStops;
    }

    const departure = parseDepartureDateTime(journeyDetails);
    if (!departure) {
      return basePlannedStops;
    }

    const fractions = computeBreakFractions(
      restPlan,
      departure,
      realRoute.durationHours * 60,
    );

    return basePlannedStops.map((stop, index) => {
      const matched = matchedRestStops[index];
      if (!matched) {
        return stop;
      }

      const tripDistanceKm = Math.round(
        fractions[index] * realRoute.distanceKm,
      );

      if (!matched.found || !matched.coordinate) {
        // No confirmed real rest area within range of this break, but
        // the exact point on the REAL route is always known regardless
        // (interpolatedCoordinate), use that instead of the mock
        // template's fixed coordinate, a break with no confirmed stop
        // should still show up in the right place along the actual
        // route, not jump to Goulburn/Pheasants Nest on a route that
        // never goes near either.
        return {
          ...stop,
          name: "Rest area (exact location not confirmed)",
          coordinate: matched.interpolatedCoordinate,
          distanceKm: tripDistanceKm,
          facilities: [],
        };
      }

      return {
        ...stop,
        name: matched.name ?? stop.name,
        coordinate: matched.coordinate,
        // How far into the trip (from departure) this stop falls, not
        // how far the rest area sits off the route itself (a separate,
        // much smaller number the backend also returns but isn't shown
        // here).
        distanceKm: tripDistanceKm,
        facilities:
          matched.facilities && matched.facilities.length > 0
            ? matched.facilities
            : stop.facilities,
      };
    });
  }, [basePlannedStops, matchedRestStops, realRoute, journeyDetails, restPlan]);

  // Driver-picked alternatives (US 2.2/2.5), keyed by stop id, layered on
  // top of plannedStops below. Starts empty and is hydrated from
  // localStorage in an effect (not a lazy useState initializer) so the
  // server render and first browser render stay aligned, same reasoning
  // as journeyDetails/restPlan above using useSyncExternalStore.
  const [overrides, setOverrides] = useState<Record<string, StopOverride>>(
    {},
  );
  const [expandedStopId, setExpandedStopId] = useState<string | null>(null);
  const [candidatesByStopId, setCandidatesByStopId] = useState<
    Record<string, RankedCandidate[]>
  >({});
  const [isFetchingCandidates, setIsFetchingCandidates] = useState(false);
  const [candidatesError, setCandidatesError] = useState("");

  useEffect(() => {
    queueMicrotask(() => {
      try {
        const raw = localStorage.getItem(STOP_OVERRIDES_STORAGE_KEY);
        if (raw) {
          setOverrides(JSON.parse(raw));
        }
      } catch {
        // Corrupt or unavailable storage, just start empty, not fatal.
      }
    });
  }, []);

  function persistOverrides(next: Record<string, StopOverride>) {
    setOverrides(next);
    try {
      localStorage.setItem(STOP_OVERRIDES_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Storage unavailable (e.g. private browsing), override still
      // works for this session via React state, just won't survive a
      // reload.
    }
  }

  // The actual fetch + rank, shared by the manual "View alternatives"
  // click and the silent auto-fetch effect below (AC 2.5.1/2.5.4: new
  // suitable options should be there as soon as a stop is flagged, not
  // only after another click). Caches per stop id so re-renders and the
  // auto-effect don't refetch what's already loaded.
  async function fetchCandidatesFor(
    stop: PlannedSafeStop,
  ): Promise<RankedCandidate[] | null> {
    if (!journeyDetails) {
      return null;
    }
    try {
      const response = await fetch(
        `${API_BASE_URL}/journeys/rest-stops/candidates`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lat: stop.coordinate.lat,
            lng: stop.coordinate.lng,
          }),
        },
      );

      if (!response.ok) {
        return null;
      }

      const data: Array<{
        name: string;
        coordinate: { lat: number; lng: number };
        distance_km: number;
        facilities: string[];
      }> = await response.json();

      const candidates = data.map(candidateToRankedStop);
      const needs = buildJourneyNeeds(journeyDetails, {
        restDueSoon: true,
        isNightTime: isNightTimeBreak(stop.restBreak),
      });
      return rankStops(candidates, needs) as RankedCandidate[];
    } catch {
      return null;
    }
  }

  async function loadAlternatives(stop: PlannedSafeStop) {
    setExpandedStopId(stop.id);
    setCandidatesError("");
    if (candidatesByStopId[stop.id]) {
      return;
    }

    setIsFetchingCandidates(true);
    const ranked = await fetchCandidatesFor(stop);
    if (ranked === null) {
      setCandidatesError("Could not load alternative stops.");
    } else {
      setCandidatesByStopId((prev) => ({ ...prev, [stop.id]: ranked }));
    }
    setIsFetchingCandidates(false);
  }

  function selectAlternative(stopId: string, candidate: RankedCandidate) {
    if (!journeyDetails) {
      return;
    }
    persistOverrides({
      ...overrides,
      [stopId]: { stop: candidate, journeySnapshot: journeyDetails },
    });
    setExpandedStopId(null);
  }

  function clearOverride(stopId: string) {
    const next = { ...overrides };
    delete next[stopId];
    persistOverrides(next);
  }

  // Every planned stop is checked, not just ones the driver explicitly
  // picked from alternatives: the underlying nearest-match (US 1.3) never
  // considered fuel or rest-timing suitability at all, only distance, so
  // a stop nobody ever touched can be just as unsuitable as one that was
  // picked and then invalidated. An override is only re-checked once
  // something that actually affects suitability changed since it was
  // picked (hasRelevantJourneyChange); a default (never-picked) stop has
  // no "since when" to compare against, so it is always checked against
  // the current journey.
  function getStopWarning(stop: PlannedSafeStop): string[] | null {
    if (!journeyDetails) {
      return null;
    }
    const override = overrides[stop.id];
    if (override && !hasRelevantJourneyChange(override.journeySnapshot, journeyDetails)) {
      return null;
    }
    const needs = buildJourneyNeeds(journeyDetails, {
      restDueSoon: true,
      isNightTime: isNightTimeBreak(stop.restBreak),
    });
    const candidate = override ? override.stop : stopToRankedCandidate(stop);
    const reasons = getStopUnsuitableReasons(candidate, needs);
    return reasons.length > 0 ? reasons : null;
  }

  // Genuinely suitable replacements for a warned stop, from whatever
  // candidates are already cached for it (populated by the auto-fetch
  // effect above, or by the driver opening "View alternatives"
  // themselves). Filtered to ones with zero unsuitable reasons, not just
  // top-ranked, ranking rewards fuel/rest fit but does not guarantee it.
  function getSuitableSuggestions(stop: PlannedSafeStop): RankedCandidate[] {
    if (!journeyDetails) {
      return [];
    }
    const candidates = candidatesByStopId[stop.id];
    if (!candidates) {
      return [];
    }
    const needs = buildJourneyNeeds(journeyDetails, {
      restDueSoon: true,
      isNightTime: isNightTimeBreak(stop.restBreak),
    });
    return candidates.filter(
      (candidate) => getStopUnsuitableReasons(candidate, needs).length === 0,
    );
  }

  // AC 2.5.2 names "Rest + Refuel options" as its own concept: a stop
  // due for rest AND needing fuel at the same time. restDueSoon is
  // always true here (every planned stop IS the recommended rest point
  // for its break), so this only depends on whether fuel is genuinely
  // needed right now.
  function isRestAndRefuelNeed(): boolean {
    if (!journeyDetails) {
      return false;
    }
    return buildJourneyNeeds(journeyDetails, { restDueSoon: true }).fuelNeeded;
  }

  // The stops actually shown: plannedStops (the real nearest-match, or
  // the mock fallback), with any driver-picked alternative (US 2.2)
  // layered on top per stop id.
  const finalStops = useMemo(() => {
    return plannedStops.map((stop) => {
      const override = overrides[stop.id];
      if (!override) {
        return stop;
      }
      return {
        ...stop,
        name: override.stop.name,
        coordinate: override.stop.coordinate,
        facilities: override.stop.facilities,
      };
    });
  }, [plannedStops, overrides]);

  // AC 2.5.4: "I see new suitable options" alongside the warning, not
  // only after a further click. Silently pre-fetches candidates for
  // every currently-warned stop that doesn't have them cached yet, the
  // manual "View alternatives" button still works the same for any
  // stop, warned or not, this just means a warned stop already has
  // something to show the moment its warning appears.
  useEffect(() => {
    const warnedStopsNeedingCandidates = finalStops.filter(
      (stop) => getStopWarning(stop) !== null && !candidatesByStopId[stop.id],
    );
    if (warnedStopsNeedingCandidates.length === 0) {
      return;
    }
    warnedStopsNeedingCandidates.forEach((stop) => {
      fetchCandidatesFor(stop).then((ranked) => {
        if (ranked !== null) {
          setCandidatesByStopId((prev) => ({ ...prev, [stop.id]: ranked }));
        }
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finalStops, overrides, journeyDetails, candidatesByStopId]);

  const driverSwitchStops = finalStops.filter(
    (stop) => stop.isDriverSwitchLocation,
  );

  // The real arrival time: departure + total driving duration + every
  // break's own duration, NOT just departure + driving (that would
  // ignore all the rest time and show an arrival hours too early, worse
  // than an honest placeholder).
  //
  // Uses journeyDetails.estimatedDrivingHours specifically, NOT
  // realRoute.durationHours, even though a real route exists: the rest
  // plan (restPlan, and every break time in it) was computed by the
  // backend from whatever was actually in estimatedDrivingHours at
  // submit time, that field is auto-filled from the real route but the
  // driver can (and did, in testing) override it, so it can genuinely
  // differ from realRoute.durationHours. Using the real route's number
  // here instead would silently combine break durations computed from
  // one driving-hours figure with a total driving time from a
  // different one, an inconsistency, not an improvement.
  const currentEta = useMemo(() => {
    if (!journeyDetails) {
      return mockRouteBreaksData.currentEta;
    }
    const departure = parseDepartureDateTime(journeyDetails);
    const drivingHours = Number(journeyDetails.estimatedDrivingHours || 0);
    if (!departure || !drivingHours) {
      return mockRouteBreaksData.currentEta;
    }
    const totalBreakMs = restPlan.reduce(
      (sum, restBreak) =>
        sum +
        (new Date(restBreak.end).getTime() -
          new Date(restBreak.start).getTime()),
      0,
    );
    const arrival = new Date(
      departure.getTime() + drivingHours * 3600000 + totalBreakMs,
    );
    return DATE_TIME_FORMAT.format(arrival);
  }, [journeyDetails, restPlan]);

  // The single object handed to RouteMap. Memoized on its real inputs
  // (realRoute/journeyDetails/finalStops, all stable references unless
  // their actual underlying data changed) so RouteMap's effect only
  // re-runs, and the map only rebuilds, when there is something real to
  // show, not on every render of this page.
  const mapData: RouteBreaksData = useMemo(() => {
    if (realRoute && journeyDetails) {
      return {
        routeGeometry: realRoute.geometry,
        destinations: journeyDetails.destination.map((destination) => ({
          label: destination.label,
          coordinate: {
            lat: destination.lat as number,
            lng: destination.lng as number,
          },
        })),
        restStops: finalStops,
        currentEta,
        currentActiveDriver: mockRouteBreaksData.currentActiveDriver,
      };
    }

    return { ...mockRouteBreaksData, restStops: finalStops, currentEta };
  }, [realRoute, journeyDetails, finalStops, currentEta]);

  return (
    <main className="container mx-auto px-4">
      <div className="flex min-h-screen flex-col gap-4 py-4">
        <header className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-slate-400">Journey Plan</p>
            <h1 className="text-2xl font-bold">Route & Breaks</h1>
          </div>
          <Link
            href="/newjourney"
            className="rounded-xl border border-slate-700 px-3 py-2 text-sm font-semibold text-slate-300 transition active:border-yellow-500 active:text-yellow-500"
          >
            Edit
          </Link>
        </header>

        {/* Missing journey details message */}
        {!journeyDetails && (
          <section className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-5">
            <h2 className="text-lg font-bold">No journey found</h2>
            <p className="mt-2 text-sm text-slate-400">
              Create a journey first so the route and break plan can be shown.
            </p>
            <Link
              href="/newjourney"
              className="mt-4 inline-flex w-full items-center justify-center rounded-xl bg-yellow-500 px-4 py-3 font-semibold text-black transition active:bg-yellow-600"
            >
              Plan My Journey
            </Link>
          </section>
        )}

        {/* Render the route and break details only if journey details are available */}
        {journeyDetails && (
          <>
            <section className="grid grid-cols-2 gap-3">
              <SummaryTile
                icon={<Navigation className="h-5 w-5" />}
                label="Current ETA"
                value={currentEta}
              />
              <SummaryTile
                icon={<UserRound className="h-5 w-5" />}
                label="Active Driver"
                value={mockRouteBreaksData.currentActiveDriver}
              />
              <SummaryTile
                icon={<Route className="h-5 w-5" />}
                label="Remaining Range"
                value={`${journeyDetails.fuelLevel} km`}
              />
              <SummaryTile
                icon={<ShieldCheck className="h-5 w-5" />}
                label="Safe Stops"
                value={`${finalStops.length}`}
              />
            </section>

            <section className="rounded-xl bg-slate-800 px-3 py-3">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-bold">Planned Route</h2>
                  <p className="text-sm text-slate-400">
                    {journeyDetails.departureLocation}
                  </p>
                </div>
                <span className="rounded-full bg-yellow-500 px-3 py-1 text-xs font-bold text-black">
                  Live Map
                </span>
              </div>

              {isFetchingRoute && (
                <p className="mb-2 text-sm text-slate-400">
                  Calculating the real route...
                </p>
              )}
              {!hasResolvedCoordinates && (
                <p className="mb-2 text-sm text-slate-400">
                  Showing a preview route, pick a departure and destination
                  from the search suggestions (not just typed text) to see
                  the real driven route here.
                </p>
              )}
              {routeFetchError && (
                <p className="mb-2 text-sm text-red-400">{routeFetchError}</p>
              )}

              <RouteMap data={mapData} />
            </section>

            <section className="flex flex-col gap-2">
              <h2 className="text-lg font-bold">Destinations</h2>
              <ol className="flex flex-col gap-2">
                {journeyDetails.destination.map((destination, index) => (
                  <li
                    key={destination.id}
                    className="flex items-start gap-3 rounded-xl bg-slate-800 px-3 py-2 text-sm"
                  >
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-yellow-500 text-xs font-bold text-black">
                      {index + 1}
                    </span>
                    <span className="text-white">{destination.label}</span>
                  </li>
                ))}
              </ol>
            </section>

            <section className="flex flex-col gap-2">
              <h2 className="text-lg font-bold">Planned Safe Stops</h2>
              {finalStops.map((stop) => (
                <SafeStopItem
                  key={stop.id}
                  stop={stop}
                  hasOverride={overrides[stop.id] !== undefined}
                  unsuitableReasons={getStopWarning(stop)}
                  suggestedCandidates={getSuitableSuggestions(stop)}
                  isRestAndRefuelNeed={isRestAndRefuelNeed()}
                  isExpanded={expandedStopId === stop.id}
                  candidates={candidatesByStopId[stop.id] ?? null}
                  isLoadingCandidates={
                    isFetchingCandidates && expandedStopId === stop.id
                  }
                  candidatesError={
                    expandedStopId === stop.id ? candidatesError : ""
                  }
                  onToggleAlternatives={() =>
                    expandedStopId === stop.id
                      ? setExpandedStopId(null)
                      : loadAlternatives(stop)
                  }
                  onSelectCandidate={(candidate) =>
                    selectAlternative(stop.id, candidate)
                  }
                  onClearOverride={() => clearOverride(stop.id)}
                />
              ))}
            </section>

            {driverSwitchStops.length > 0 && (
              <section className="rounded-xl border border-yellow-500 bg-slate-900 px-3 py-3">
                <h2 className="text-lg font-bold text-yellow-500">
                  Driver Switch Locations
                </h2>
                <div className="mt-2 flex flex-col gap-2">
                  {driverSwitchStops.map((stop) => (
                    <p key={stop.id} className="text-sm text-slate-300">
                      {stop.name}
                    </p>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </main>
  );
}

/**
 * A summary tile component displaying an icon, label, and value.
 */
function SummaryTile({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl bg-slate-800 px-3 py-3">
      <div className="mb-2 text-yellow-500">{icon}</div>
      <p className="text-xs font-semibold uppercase text-slate-400">{label}</p>
      <p className="mt-1 text-lg font-bold text-white">{value}</p>
    </div>
  );
}

/**
 * A component representing a safe stop item, displaying its name, distance,
 * ETA, and facilities. Also lets the driver browse and pick a ranked
 * alternative nearby (US 2.2), and shows a warning when a previously
 * picked stop no longer fits after the journey changed (US 2.5).
 */
function SafeStopItem({
  stop,
  hasOverride,
  unsuitableReasons,
  suggestedCandidates,
  isRestAndRefuelNeed,
  isExpanded,
  candidates,
  isLoadingCandidates,
  candidatesError,
  onToggleAlternatives,
  onSelectCandidate,
  onClearOverride,
}: {
  stop: PlannedSafeStop;
  hasOverride: boolean;
  unsuitableReasons: string[] | null;
  suggestedCandidates: RankedCandidate[];
  isRestAndRefuelNeed: boolean;
  isExpanded: boolean;
  candidates: RankedCandidate[] | null;
  isLoadingCandidates: boolean;
  candidatesError: string;
  onToggleAlternatives: () => void;
  onSelectCandidate: (candidate: RankedCandidate) => void;
  onClearOverride: () => void;
}) {
  return (
    <article className="rounded-xl bg-slate-800 px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-bold text-white">{stop.name}</h3>
          <p className="mt-1 text-sm text-slate-400">
            {stop.distanceKm} km away · ETA {stop.estimatedArrivalTime}
          </p>
          <p className="mt-1 text-xs text-slate-500">{stop.restBreak.reason}</p>
        </div>
        {stop.isDriverSwitchLocation && (
          <span className="shrink-0 rounded-full border border-yellow-500 px-2 py-1 text-xs font-bold text-yellow-500">
            Switch
          </span>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {stop.facilities.map((facility) => (
          <span
            key={facility}
            className="rounded-full bg-slate-900 px-2 py-1 text-xs font-semibold text-slate-300"
          >
            {facility}
          </span>
        ))}
      </div>

      {unsuitableReasons && (
        <div className="mt-3 rounded-lg border border-red-500 bg-red-950/40 px-3 py-2">
          <p className="text-xs font-bold text-red-400">
            Your journey changed, this stop may no longer be a good fit:
          </p>
          <ul className="mt-1 list-inside list-disc text-xs text-red-300">
            {unsuitableReasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>

          {/* AC 2.5.4: new suitable options shown right alongside the
              warning, not gated behind a further click. AC 2.5.2 names
              "Rest + Refuel options" as its own concept when fuel is
              genuinely needed right now. */}
          <p className="mt-3 text-xs font-bold text-slate-300">
            {isRestAndRefuelNeed ? "Rest + Refuel options nearby:" : "Suggested alternatives:"}
          </p>
          {candidates === null ? (
            <p className="mt-1 text-xs text-slate-400">
              Finding nearby options...
            </p>
          ) : suggestedCandidates.length === 0 ? (
            <p className="mt-1 text-xs text-slate-400">
              No genuinely suitable stop found within 50 km of here.
            </p>
          ) : (
            <div className="mt-1 flex flex-col gap-1">
              {suggestedCandidates.slice(0, 3).map((candidate) => (
                <button
                  key={candidate.id}
                  type="button"
                  onClick={() => onSelectCandidate(candidate)}
                  className="rounded-lg bg-slate-900 px-3 py-2 text-left transition active:bg-slate-700"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-white">
                      {candidate.name}
                    </span>
                    <span className="shrink-0 text-xs text-slate-400">
                      {candidate.detourDistanceKm.toFixed(1)} km off-route
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={onToggleAlternatives}
          className="text-xs font-semibold text-yellow-500 underline underline-offset-2"
        >
          {isExpanded ? "Hide alternatives" : "View alternatives"}
        </button>
        {hasOverride && (
          <button
            type="button"
            onClick={onClearOverride}
            className="text-xs font-semibold text-slate-400 underline underline-offset-2"
          >
            Use original suggestion
          </button>
        )}
      </div>

      {isExpanded && (
        <div className="mt-3 flex flex-col gap-2 border-t border-slate-700 pt-3">
          {isLoadingCandidates && (
            <p className="text-xs text-slate-400">Finding nearby stops...</p>
          )}
          {candidatesError && (
            <p className="text-xs text-red-400">{candidatesError}</p>
          )}
          {!isLoadingCandidates && candidates && candidates.length === 0 && (
            <p className="text-xs text-slate-400">
              No other rest areas found nearby.
            </p>
          )}
          {candidates?.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              onClick={() => onSelectCandidate(candidate)}
              className="rounded-lg bg-slate-900 px-3 py-2 text-left transition active:bg-slate-700"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-white">
                  {candidate.name}
                </span>
                <span className="shrink-0 text-xs text-slate-400">
                  {candidate.detourDistanceKm.toFixed(1)} km off-route
                </span>
              </div>
              {candidate.rankingReasons.length > 0 && (
                <p className="mt-1 text-xs text-slate-400">
                  {candidate.rankingReasons.join(" · ")}
                </p>
              )}
            </button>
          ))}
        </div>
      )}
    </article>
  );
}
