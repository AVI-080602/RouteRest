"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  BedDouble,
  Clock,
  Fuel,
  Ruler,
  ShieldCheck,
  Timer,
  Users,
} from "lucide-react";
import RouteMap from "@/components/RouteMap";
import Disclaimer from "@/components/Disclaimer";
import CameraMonitoringPreview from "@/components/CameraMonitoringPreview";
import { JourneyDetails, RestBreak } from "@/types/journeyDetails";
import {
  Coordinate,
  PlannedSafeStop,
  RouteBreaksData,
} from "@/types/routeBreaks";
import {
  NAVIGATION_PLAN_STORAGE_KEY,
  NAVIGATION_PROGRESS_STORAGE_KEY,
  NavigationPlan,
  NavigationWaypoint,
  RouteStep,
} from "@/types/navigation";
import { RankedStop, rankStops } from "@/utils/rankStops";
import {
  buildJourneyNeeds,
  calculateTotalRestMinutes,
  getStopUnsuitableReasons,
  hasRelevantJourneyChange,
} from "@/utils/updateStopRecommendations";
import { shortenLocationLabel } from "@/utils/locationLabel";
import { nearestVertexIndex } from "@/utils/geo";
import {
  GHOST_BUTTON_CLASS,
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
} from "@/utils/ui";

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
  coordinate: Coordinate;
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
  geometry: Coordinate[];
  // Turn instructions, empty when the backend does not provide them.
  steps: RouteStep[];
};

// The wire shape of POST /journeys/route. `steps` is optional so this
// page keeps working against a backend that predates turn instructions.
type RouteResponseBody = {
  distance_km: number;
  duration_hours: number;
  geometry: Coordinate[];
  steps?: RouteStep[];
};

function toRealRoute(body: RouteResponseBody): RealRoute {
  return {
    distanceKm: body.distance_km,
    durationHours: body.duration_hours,
    geometry: body.geometry,
    steps: body.steps ?? [],
  };
}

// One per break, in the same order, from POST /journeys/rest-stops.
// found=false is a real, valid answer (no real rest area within range
// of that break's position), not a request failure.
type MatchedRestStop = {
  found: boolean;
  name?: string;
  coordinate?: Coordinate;
  facilities?: string[];
  // Always present regardless of found, the actual point on the real
  // route this break falls at. Used as the marker position when found
  // is false, so a break with no confirmed real rest area nearby still
  // shows up in the right place along the route, instead of jumping to
  // an unrelated fixed mock location.
  interpolatedCoordinate: Coordinate;
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

// A store that never changes: the server snapshot says "not hydrated",
// the client snapshot says "hydrated". Reading it through
// useSyncExternalStore gives a flag that is false during SSR and the
// hydration render and true from the first client render onward, with
// none of the effect-plus-state dance (and none of the lint warnings)
// of the usual isMounted pattern.
const subscribeNoop = () => () => {};
const getHydratedClient = () => true;
const getHydratedServer = () => false;

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

// Preview data, shown ONLY when the saved journey has no real geocoded
// coordinates (a draft from an older version of the form that accepted
// free text). Everything with real coordinates uses the real route.
const mockRouteBreaksData: RouteBreaksData = {
  routeGeometry: [
    { lat: -37.8136, lng: 144.9631 },
    { lat: -36.758, lng: 144.28 },
    { lat: -35.2809, lng: 149.13 },
    { lat: -33.8688, lng: 151.2093 },
  ],
  departure: {
    label: "Melbourne, Victoria, Australia",
    coordinate: { lat: -37.8136, lng: 144.9631 },
  },
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

/** "13.47" hours -> "13 h 28 min". */
function formatHours(hours: number) {
  const totalMinutes = Math.round(hours * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} min`;
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
    const elapsedDrivingMinutes =
      (elapsedWallClockMs - cumulativeRestMs) / 60000;
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
    coordinate: Coordinate;
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

const isMajorRest = (restBreak: RestBreak) =>
  restBreak.reason.toLowerCase().includes("major rest");

function buildPlannedStops(
  restPlan: RestBreak[],
  hasCoDriver: boolean,
): PlannedSafeStop[] {
  const stopTemplates = mockRouteBreaksData.restStops;

  // This is the bridge between US1.3 and Route & Breaks: the backend tells
  // us when rest is required, and the rest-stops match (below) replaces
  // each template with a real rest area once the route is known.
  return restPlan.map((restBreak, index) => {
    const template = stopTemplates[index % stopTemplates.length];

    return {
      ...template,
      id: `${template.id}-${index}`,
      estimatedArrivalTime: formatBreakDateTime(restBreak.start),
      restBreak,
      // A driver change only makes sense at a major rest, and only when
      // there is a second driver to change to. Earlier this also
      // depended on which mock template slot the break happened to land
      // on (odd/even index), which made "Switch" appear on arbitrary
      // stops (BA item 9).
      isDriverSwitchLocation: hasCoDriver && isMajorRest(restBreak),
    };
  });
}

export default function RouteBreaksPage() {
  const router = useRouter();
  const fatigueWarningTimeoutRef = useRef<number | null>(null);
  const [showFatigueWarning, setShowFatigueWarning] = useState(false);

  /**
   * Shows a warning to the driver when drowsiness is detected.
   */
  const showDrowsinessWarning = useCallback(() => {
    setShowFatigueWarning(true);
    
    // Clear any existing fatigue warning timeout before setting a new one.
    if (fatigueWarningTimeoutRef.current) {
      window.clearTimeout(fatigueWarningTimeoutRef.current);
    }
    
    fatigueWarningTimeoutRef.current = window.setTimeout(() => {
      setShowFatigueWarning(false);
      fatigueWarningTimeoutRef.current = null;
    }, 3000);
  }, []);

  useEffect(() => {
    // Cleanup function to clear the fatigue warning timeout when the component unmounts.
    return () => {
      if (fatigueWarningTimeoutRef.current) {
        window.clearTimeout(fatigueWarningTimeoutRef.current);
      }
    };
  }, []);

  // false during SSR and the hydration render, true afterwards. Gates the
  // "No journey found" panel: without it, every visit painted that panel
  // for a frame before localStorage was read, the flash the BA reported
  // after Start Journey (item 8).
  const hydrated = useSyncExternalStore(
    subscribeNoop,
    getHydratedClient,
    getHydratedServer,
  );

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
  // recomputed into a new object every render), so downstream memos and
  // effects only re-run when the journey actually changes.
  const journeyDetails: JourneyDetails | null = useMemo(
    () => (savedJourney ? JSON.parse(savedJourney) : null),
    [savedJourney],
  );
  const restPlan: RestBreak[] = useMemo(
    () => (savedRestPlan ? JSON.parse(savedRestPlan) : []),
    [savedRestPlan],
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

  // One planned stop per required break, built from the template stops
  // until the rest-stops match below replaces each with a real rest area.
  // A real journey whose rest plan is EMPTY (short enough that no break
  // is legally required) gets no stops at all: it used to fall back to
  // the two template locations, which then went into the navigation
  // hand-off as waypoints hundreds of kilometres off an Albury-Wodonga
  // trip and made every re-route fail. The template stops are only ever
  // shown for the coordinate-less preview.
  const basePlannedStops = useMemo(() => {
    if (restPlan.length > 0) {
      return buildPlannedStops(restPlan, journeyDetails?.hasCoDriver ?? false);
    }
    return hasResolvedCoordinates ? [] : mockRouteBreaksData.restStops;
  }, [restPlan, journeyDetails, hasResolvedCoordinates]);

  const [realRoute, setRealRoute] = useState<RealRoute | null>(null);
  const [routeFetchError, setRouteFetchError] = useState("");
  const [isFetchingRoute, setIsFetchingRoute] = useState(false);

  // The base route: departure -> destinations, exactly as planned. The
  // rest-stops match and the break fractions are computed against THIS
  // route, so it must stay stable even when a detour route (below) is
  // being displayed instead.
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

        const data: RouteResponseBody = await response.json();
        setRealRoute(toRealRoute(data));
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
  // the 2-location template cycling with the real ~5,000-row rest_area
  // table). Silent failure on purpose here, same reasoning as the
  // driving-hours auto-fill on newjourney/page.tsx: this is a
  // convenience upgrade over the template stand-ins, not a required
  // step, basePlannedStops above already has something reasonable to
  // show.
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
          coordinate?: Coordinate;
          facilities?: string[];
          interpolated_coordinate: Coordinate;
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
  // found, the template stand-in for that specific break otherwise
  // (never all-or-nothing, a break with no real match nearby still shows
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
        // (interpolatedCoordinate), use that instead of the template's
        // fixed coordinate, a break with no confirmed stop should still
        // show up in the right place along the actual route.
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
  const [overrides, setOverrides] = useState<Record<string, StopOverride>>({});
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
        coordinate: Coordinate;
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
    if (
      override &&
      !hasRelevantJourneyChange(override.journeySnapshot, journeyDetails)
    ) {
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
  // the template fallback), with any driver-picked alternative (US 2.2)
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

  // ---- Detour route (BA item 11): re-route through the stops the ----
  // ---- driver actually picked, so the map line reflects the plan.  ----
  //
  // Display-only. The base route above stays untouched because the
  // rest-stops matching and the break fractions are relative to it.
  // Only override-picked stops are inserted as waypoints: the default
  // matched stops already sit on or beside the base route, and every
  // extra waypoint set costs one routing call from a shared daily quota.
  // Results keyed by the exact waypoint list they were fetched for. A
  // key that is present is settled (a route, or the error that came
  // back); a key that is absent is in flight. Keying by the request
  // makes "Use original suggestion" instant (the base route needs no
  // key at all) and re-picking a stop a cache hit, with no separate
  // loading flag or cache ref to keep in sync.
  const [detourResults, setDetourResults] = useState<
    Record<string, { route: RealRoute } | { error: string }>
  >({});

  const detourWaypoints = useMemo<Coordinate[] | null>(() => {
    if (
      !realRoute ||
      !journeyDetails?.departureCoordinate ||
      Object.keys(overrides).length === 0
    ) {
      return null;
    }
    // Stops and destinations merged by position along the base route,
    // since a picked stop can sit between two destinations.
    const middle = [
      ...journeyDetails.destination.map((destination) => {
        const coordinate = {
          lat: destination.lat as number,
          lng: destination.lng as number,
        };
        return {
          coordinate,
          at: nearestVertexIndex(realRoute.geometry, coordinate),
        };
      }),
      ...finalStops
        .filter((stop) => overrides[stop.id])
        .map((stop) => ({
          coordinate: stop.coordinate,
          at: nearestVertexIndex(realRoute.geometry, stop.coordinate),
        })),
    ].sort((a, b) => a.at - b.at);
    return [
      journeyDetails.departureCoordinate,
      ...middle.map((item) => item.coordinate),
    ];
  }, [realRoute, journeyDetails, finalStops, overrides]);

  // A string key fully represents the waypoint list, so the effect can
  // depend on it alone and skip re-fetching when nothing moved.
  const detourKey = detourWaypoints ? JSON.stringify(detourWaypoints) : "";

  const detourEntry = detourKey ? detourResults[detourKey] : undefined;
  const isFetchingDetour = detourKey !== "" && detourEntry === undefined;
  const detourRoute =
    detourEntry && "route" in detourEntry ? detourEntry.route : null;
  const detourError =
    detourEntry && "error" in detourEntry ? detourEntry.error : "";

  useEffect(() => {
    if (!detourKey || detourResults[detourKey]) {
      return;
    }

    const controller = new AbortController();
    const settle = (result: { route: RealRoute } | { error: string }) =>
      setDetourResults((prev) => ({ ...prev, [detourKey]: result }));

    (async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/journeys/route`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ waypoints: JSON.parse(detourKey) }),
          signal: controller.signal,
        });
        if (!response.ok) {
          // Keep showing the base route, say so, never pretend the
          // detour succeeded.
          settle({
            error:
              "Could not re-route through your chosen stop, showing the original route.",
          });
          return;
        }
        const data: RouteResponseBody = await response.json();
        settle({ route: toRealRoute(data) });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        settle({
          error:
            "Could not reach the routing service, showing the original route.",
        });
      }
    })();
    return () => controller.abort();
  }, [detourKey, detourResults]);

  // What the map and the summary show: the detour when there is one and
  // it loaded, the base route otherwise.
  const displayRoute = detourRoute ?? realRoute;

  // The real arrival time: departure + total driving duration + every
  // break's own duration, NOT just departure + driving (that would
  // ignore all the rest time and show an arrival hours too early, worse
  // than an honest placeholder).
  //
  // Uses journeyDetails.estimatedDrivingHours specifically, NOT
  // realRoute.durationHours: the rest plan (restPlan, and every break
  // time in it) was computed by the backend from whatever was in
  // estimatedDrivingHours at submit time. Mixing break durations from
  // one driving-hours figure with a total from a different one would be
  // an inconsistency, not an improvement. The Driving time tile below
  // shows the routed figure separately. null when unknown, never a
  // made-up time.
  const currentEta = useMemo<string | null>(() => {
    if (!journeyDetails) {
      return null;
    }
    const departure = parseDepartureDateTime(journeyDetails);
    const drivingHours = Number(journeyDetails.estimatedDrivingHours || 0);
    if (!departure || !drivingHours) {
      return null;
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

  const warnedStops = finalStops.filter(
    (stop) => getStopWarning(stop) !== null,
  );
  // A string key so mapData below only changes identity when the SET of
  // warned stops changes, not on every render.
  const warnedKey = warnedStops.map((stop) => stop.id).join("|");

  const lastDestination =
    journeyDetails && journeyDetails.destination.length > 0
      ? journeyDetails.destination[journeyDetails.destination.length - 1]
      : null;

  const mapTitle =
    journeyDetails && lastDestination
      ? `${shortenLocationLabel(journeyDetails.departureLocation)} to ${shortenLocationLabel(lastDestination.label)}${
          finalStops.length > 0
            ? ` via ${finalStops.length} stop${finalStops.length === 1 ? "" : "s"}`
            : ""
        }`
      : "Preview route";

  // The single object handed to RouteMap. Memoized on its real inputs so
  // the map only updates when something on it actually changed.
  const mapData: RouteBreaksData = useMemo(() => {
    const warnedStopIds = warnedKey ? warnedKey.split("|") : [];
    if (hasResolvedCoordinates && journeyDetails) {
      return {
        // Empty until the real route arrives: the map then draws it in
        // place, instead of first showing an unrelated preview line and
        // rebuilding (the second visible jump the BA saw).
        routeGeometry: displayRoute?.geometry ?? [],
        departure: journeyDetails.departureCoordinate
          ? {
              label: journeyDetails.departureLocation,
              coordinate: journeyDetails.departureCoordinate,
            }
          : null,
        destinations: journeyDetails.destination.map((destination) => ({
          label: destination.label,
          coordinate: {
            lat: destination.lat as number,
            lng: destination.lng as number,
          },
        })),
        restStops: finalStops,
        warnedStopIds,
      };
    }

    return { ...mockRouteBreaksData, restStops: finalStops, warnedStopIds };
  }, [
    hasResolvedCoordinates,
    journeyDetails,
    displayRoute,
    finalStops,
    warnedKey,
  ]);

  const canStartNavigation =
    hasResolvedCoordinates && displayRoute !== null && !isFetchingDetour;

  // Packages the plan for the /navigate page (BA item 2, the missing
  // last step of the MVP flow). Waypoints go in visiting order: departure,
  // then every stop and intermediate destination sorted by how far along
  // the displayed route they sit, then the final destination.
  function startNavigation() {
    if (
      !journeyDetails ||
      !displayRoute ||
      !journeyDetails.departureCoordinate
    ) {
      return;
    }
    const geometry = displayRoute.geometry;
    const middle: Array<{ waypoint: NavigationWaypoint; at: number }> = [
      ...journeyDetails.destination.map((destination) => {
        const coordinate = {
          lat: destination.lat as number,
          lng: destination.lng as number,
        };
        return {
          at: nearestVertexIndex(geometry, coordinate),
          waypoint: {
            kind: "destination" as const,
            id: destination.id,
            name: destination.label,
            shortName: shortenLocationLabel(destination.label),
            ...coordinate,
          },
        };
      }),
      ...finalStops.map((stop) => ({
        at: nearestVertexIndex(geometry, stop.coordinate),
        waypoint: {
          kind: "stop" as const,
          id: stop.id,
          name: stop.name,
          shortName: stop.name,
          restBreak: stop.restBreak,
          facilities: stop.facilities,
          ...stop.coordinate,
        },
      })),
    ].sort((a, b) => a.at - b.at);

    const plan: NavigationPlan = {
      waypoints: [
        {
          kind: "departure",
          id: "departure",
          name: journeyDetails.departureLocation,
          shortName: shortenLocationLabel(journeyDetails.departureLocation),
          ...journeyDetails.departureCoordinate,
        },
        ...middle.map((item) => item.waypoint),
      ],
      geometry,
      steps: displayRoute.steps,
      distanceKm: displayRoute.distanceKm,
      durationHours: displayRoute.durationHours,
      departureDateTime: `${journeyDetails.departureDate}T${journeyDetails.departureTime}:00`,
      createdAt: new Date().toISOString(),
    };

    try {
      localStorage.setItem(NAVIGATION_PLAN_STORAGE_KEY, JSON.stringify(plan));
      // A fresh plan always starts from the beginning.
      localStorage.removeItem(NAVIGATION_PROGRESS_STORAGE_KEY);
    } catch {
      // Storage unavailable: navigation cannot resume after a reload, but
      // it still works for this session because /navigate also accepts
      // the plan through history state below.
    }
    router.push("/navigate");
  }

  if (!hydrated) {
    return <PlanSkeleton />;
  }

  return (
    <main className="container mx-auto px-4">
      {showFatigueWarning && (
        <div
          role="alert"
          className="fixed left-4 right-4 top-4 z-50 rounded-xl border border-danger-line bg-danger px-4 py-3 text-center text-sm font-bold text-white shadow-lg"
        >
          Fatigue warning detected. Prepare to rest safely.
        </div>
      )}

      <div className="flex min-h-screen flex-col gap-4 py-4 pb-28 lg:pb-4">
        <header className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-muted">Journey Plan</p>
            <h1 className="text-2xl font-bold">Route & Breaks</h1>
          </div>
          <Link href="/newjourney" className={GHOST_BUTTON_CLASS}>
            Edit journey
          </Link>
        </header>

        {/* Missing journey details message */}
        {!journeyDetails && (
          <section className="rounded-xl border border-line bg-surface px-4 py-5">
            <h2 className="text-lg font-bold">No journey found</h2>
            <p className="mt-2 text-sm text-muted">
              Create a journey first so the route and break plan can be shown.
            </p>
            <Link href="/newjourney" className={`mt-4 ${PRIMARY_BUTTON_CLASS}`}>
              Plan my journey
            </Link>
          </section>
        )}

        {journeyDetails && (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:grid-rows-[auto_1fr] lg:items-start">
            {/* Summary: always visible, on every screen size (BA item 12). */}
            <section
              aria-labelledby="summary-heading"
              className="lg:col-start-1 lg:row-start-1"
            >
              <h2 id="summary-heading" className="sr-only">
                Journey summary
              </h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <SummaryTile
                  icon={<Clock className="h-5 w-5" />}
                  label="Arrival"
                  value={currentEta ?? "—"}
                />
                <SummaryTile
                  icon={<Timer className="h-5 w-5" />}
                  label="Driving time"
                  value={
                    displayRoute ? formatHours(displayRoute.durationHours) : "—"
                  }
                />
                <SummaryTile
                  icon={<Ruler className="h-5 w-5" />}
                  label="Distance"
                  value={
                    displayRoute
                      ? `${Math.round(displayRoute.distanceKm)} km`
                      : "—"
                  }
                />
                <SummaryTile
                  icon={<Fuel className="h-5 w-5" />}
                  label="Remaining range"
                  value={`${journeyDetails.fuelLevel} km`}
                />
                <SummaryTile
                  icon={<BedDouble className="h-5 w-5" />}
                  label="Rest stops"
                  value={`${finalStops.length}`}
                  detail={
                    restPlan.length > 0
                      ? `${formatHours(calculateTotalRestMinutes(restPlan) / 60)} of rest`
                      : undefined
                  }
                />
                <SummaryTile
                  icon={<Users className="h-5 w-5" />}
                  label="Drivers"
                  value={journeyDetails.hasCoDriver ? "Two-up" : "Solo"}
                />
              </div>
              {/* Safety line: the one thing a driver checks before leaving. */}
              <div
                className={`mt-3 flex items-center gap-2 rounded-xl px-3 py-2 text-sm ${
                  warnedStops.length === 0
                    ? "bg-brand-tint text-brand-strong"
                    : "bg-danger-tint text-danger"
                }`}
              >
                <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden />
                {finalStops.length === 0 ? (
                  <span>No rest stops are required for this journey.</span>
                ) : warnedStops.length === 0 ? (
                  <span>
                    All {finalStops.length} planned stop
                    {finalStops.length === 1 ? "" : "s"} suit this journey.
                  </span>
                ) : (
                  <a
                    href={`#stop-${warnedStops[0].id}`}
                    className="underline underline-offset-2"
                  >
                    {warnedStops.length} stop
                    {warnedStops.length === 1 ? "" : "s"} need attention
                  </a>
                )}
              </div>
              <div className="mt-3">
                <CameraMonitoringPreview
                  onDrowsinessWarning={showDrowsinessWarning}
                />
              </div>
            </section>

            {/* Map: sticky, viewport-tall column on wide screens so the
                plan on the left and the map on the right are visible
                together (BA item 11). Stacked on phones. */}
            <section
              aria-labelledby="map-heading"
              className="rounded-xl border border-line bg-surface-alt p-3 lg:sticky lg:top-4 lg:col-start-2 lg:row-start-1 lg:row-span-2"
            >
              <div className="mb-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 id="map-heading" className="text-lg font-bold">
                    Planned Route
                  </h2>
                  <p
                    className="truncate text-sm text-muted"
                    title={`${journeyDetails.departureLocation}${lastDestination ? ` to ${lastDestination.label}` : ""}`}
                  >
                    {shortenLocationLabel(journeyDetails.departureLocation)}
                    {lastDestination
                      ? ` to ${shortenLocationLabel(lastDestination.label)}`
                      : ""}
                  </p>
                </div>
                <RouteStatusBadge
                  status={
                    !hasResolvedCoordinates
                      ? "preview"
                      : isFetchingRoute || isFetchingDetour
                        ? "updating"
                        : displayRoute
                          ? "real"
                          : "preview"
                  }
                />
              </div>

              {!hasResolvedCoordinates && (
                <p className="mb-2 text-sm text-muted">
                  Showing a preview route. Pick a departure and destination from
                  the search suggestions to see the real driven route.
                </p>
              )}
              {routeFetchError && (
                <p className="mb-2 text-sm text-danger">{routeFetchError}</p>
              )}
              {detourError && (
                <p className="mb-2 text-sm text-danger">{detourError}</p>
              )}

              <RouteMap
                data={mapData}
                title={mapTitle}
                initialCenter={journeyDetails.departureCoordinate}
                isRoutePending={isFetchingDetour}
                className="h-[420px] lg:h-[calc(100vh-11rem)]"
              />
            </section>

            {/* The plan itself. */}
            <div className="flex flex-col gap-4 lg:col-start-1 lg:row-start-2">
              <section
                aria-labelledby="destinations-heading"
                className="flex flex-col gap-2"
              >
                <h2 id="destinations-heading" className="text-lg font-bold">
                  Destinations
                </h2>
                <ol className="flex flex-col gap-2">
                  {journeyDetails.destination.map((destination, index) => (
                    <li
                      key={destination.id}
                      className="flex items-center gap-3 rounded-xl bg-surface-alt px-3 py-2 text-sm"
                    >
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-bold text-white">
                        {index + 1}
                      </span>
                      <span
                        className="truncate text-ink"
                        title={destination.label}
                      >
                        {shortenLocationLabel(destination.label)}
                      </span>
                    </li>
                  ))}
                </ol>
              </section>

              <section
                aria-labelledby="stops-heading"
                className="flex flex-col gap-2"
              >
                <h2 id="stops-heading" className="text-lg font-bold">
                  Planned Safe Stops
                </h2>
                {finalStops.length === 0 && (
                  <p className="rounded-xl bg-surface-alt px-3 py-3 text-sm text-muted">
                    This journey is short enough that no rest break is required
                    under the NHVR rules.
                  </p>
                )}
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

              {/* On wide screens the action sits under the plan column;
                  on phones it is the fixed bar below. */}
              <div className="hidden lg:block">
                <StartNavigationButton
                  disabled={!canStartNavigation}
                  onClick={startNavigation}
                />
              </div>
            </div>
          </div>
        )}

        <Disclaimer className="mt-2" />
      </div>

      {journeyDetails && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur lg:hidden">
          <div className="container mx-auto">
            <StartNavigationButton
              disabled={!canStartNavigation}
              onClick={startNavigation}
            />
          </div>
        </div>
      )}
    </main>
  );
}

function StartNavigationButton({
  disabled,
  onClick,
}: {
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={PRIMARY_BUTTON_CLASS}
      title={
        disabled
          ? "Available once the real route has loaded"
          : "Follow this route with your stops on the map"
      }
    >
      Start Navigation
    </button>
  );
}

/** Replaces the yellow "Live Map" pill, which looked like a button and
 * did nothing (BA item 9). A plain status label instead. */
function RouteStatusBadge({
  status,
}: {
  status: "preview" | "updating" | "real";
}) {
  const text =
    status === "preview"
      ? "Preview route"
      : status === "updating"
        ? "Updating route..."
        : "Real HGV route";
  return (
    <span
      className="shrink-0 rounded-full bg-surface px-3 py-1 text-xs font-semibold text-muted"
      aria-live="polite"
    >
      {text}
    </span>
  );
}

/** Neutral placeholder for the one frame before localStorage has been
 * read. Same heights as the real layout so nothing jumps. */
function PlanSkeleton() {
  return (
    <main className="container mx-auto px-4" aria-busy="true">
      <div className="flex min-h-screen flex-col gap-4 py-4">
        <div className="h-12 w-48 rounded-xl bg-surface-alt" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="h-24 rounded-xl bg-surface-alt" />
          ))}
        </div>
        <div className="h-[420px] rounded-xl bg-surface-alt" />
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
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="rounded-xl bg-surface-alt px-3 py-3">
      <div className="mb-2 text-brand">{icon}</div>
      <p className="text-xs font-semibold uppercase text-muted">{label}</p>
      <p className="mt-1 text-lg font-bold text-ink">{value}</p>
      {detail && <p className="text-xs text-muted">{detail}</p>}
    </div>
  );
}

/** One selectable alternative. The whole card is the button, with an
 * explicit "Use this stop" label so it reads as an action rather than a
 * list entry that happens to be clickable (BA item 9). */
function CandidateButton({
  candidate,
  onSelect,
  showReasons,
}: {
  candidate: RankedCandidate;
  onSelect: (candidate: RankedCandidate) => void;
  showReasons: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(candidate)}
      aria-label={`Use ${candidate.name} for this rest`}
      className="rounded-lg border border-line bg-surface px-3 py-2 text-left transition hover:border-brand active:bg-brand-tint"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <span className="block truncate text-sm font-semibold text-ink">
            {candidate.name}
          </span>
          <span className="block text-xs text-muted">
            {candidate.detourDistanceKm.toFixed(1)} km off-route
          </span>
        </div>
        <span className="shrink-0 rounded-lg border border-brand px-2 py-1 text-xs font-semibold text-brand">
          Use this stop
        </span>
      </div>
      {showReasons && candidate.rankingReasons.length > 0 && (
        <p className="mt-1 text-xs text-muted">
          {candidate.rankingReasons.join(" · ")}
        </p>
      )}
    </button>
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
    <article
      id={`stop-${stop.id}`}
      className={`scroll-mt-4 rounded-xl bg-surface-alt px-3 py-3 ${
        unsuitableReasons ? "border border-danger-line" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-bold text-ink">{stop.name}</h3>
          <p className="mt-1 text-sm text-muted">
            {stop.distanceKm} km into the trip · arrive{" "}
            {stop.estimatedArrivalTime}
          </p>
          <p className="mt-1 text-xs text-muted">{stop.restBreak.reason}</p>
        </div>
        {/* A label, not a button: it explains the stop, it does nothing
            when tapped, and the tooltip says why it is here. */}
        {stop.isDriverSwitchLocation && (
          <span
            className="shrink-0 rounded-full bg-brand-tint px-2 py-1 text-xs font-semibold text-brand-strong"
            title="Two-up journey: swap drivers at this major rest"
          >
            Driver change
          </span>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {stop.facilities.map((facility) => (
          <span
            key={facility}
            className="rounded-full bg-surface px-2 py-1 text-xs font-semibold text-muted"
          >
            {facility}
          </span>
        ))}
      </div>

      {unsuitableReasons && (
        <div className="mt-3 rounded-lg border border-danger-line bg-danger-tint px-3 py-2">
          <p className="text-xs font-bold text-danger">
            This stop may no longer suit your journey:
          </p>
          <ul className="mt-1 list-inside list-disc text-xs text-danger">
            {unsuitableReasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>

          {/* AC 2.5.4: new suitable options shown right alongside the
              warning, not gated behind a further click. AC 2.5.2 names
              "Rest + Refuel options" as its own concept when fuel is
              genuinely needed right now. */}
          <p className="mt-3 text-xs font-bold text-muted">
            {isRestAndRefuelNeed
              ? "Rest + Refuel options nearby:"
              : "Suggested alternatives:"}
          </p>
          {candidates === null ? (
            <p className="mt-1 text-xs text-muted">Finding nearby options...</p>
          ) : suggestedCandidates.length === 0 ? (
            <p className="mt-1 text-xs text-muted">
              No genuinely suitable stop found within 50 km of here.
            </p>
          ) : (
            <div className="mt-1 flex flex-col gap-1">
              {suggestedCandidates.slice(0, 3).map((candidate) => (
                <CandidateButton
                  key={candidate.id}
                  candidate={candidate}
                  onSelect={onSelectCandidate}
                  showReasons={false}
                />
              ))}
            </div>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onToggleAlternatives}
          aria-expanded={isExpanded}
          className={SECONDARY_BUTTON_CLASS}
        >
          {isExpanded ? "Hide alternatives" : "View alternatives"}
        </button>
        {hasOverride && (
          <button
            type="button"
            onClick={onClearOverride}
            className={GHOST_BUTTON_CLASS}
          >
            Use original suggestion
          </button>
        )}
      </div>

      {isExpanded && (
        <div className="mt-3 flex flex-col gap-2 border-t border-line pt-3">
          {isLoadingCandidates && (
            <p className="text-xs text-muted">Finding nearby stops...</p>
          )}
          {candidatesError && (
            <p className="text-xs text-danger">{candidatesError}</p>
          )}
          {!isLoadingCandidates && candidates && candidates.length === 0 && (
            <p className="text-xs text-muted">
              No other rest areas found nearby.
            </p>
          )}
          {candidates?.map((candidate) => (
            <CandidateButton
              key={candidate.id}
              candidate={candidate}
              onSelect={onSelectCandidate}
              showReasons
            />
          ))}
        </div>
      )}
    </article>
  );
}
