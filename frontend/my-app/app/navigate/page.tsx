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
  AlertTriangle,
  CornerUpRight,
  Crosshair,
  Flag,
  MapPin,
} from "lucide-react";
import RouteMap from "@/components/RouteMap";
import Disclaimer from "@/components/Disclaimer";
import CameraMonitoringPreview from "@/components/CameraMonitoringPreview";
import {
  Coordinate,
  RouteBreaksData,
  VehiclePosition,
} from "@/types/routeBreaks";
import {
  NAVIGATION_PLAN_STORAGE_KEY,
  NAVIGATION_PROGRESS_STORAGE_KEY,
  NavigationPlan,
  NavigationProgress,
  NavigationWaypoint,
  RouteStep,
} from "@/types/navigation";
import { saveSelectedAfterRestStop } from "@/utils/afterRestStorage";
import {
  bearingDegrees,
  haversineKm,
  nearestPointOnPolyline,
  offsetMetres,
  pointAtDistance,
  polylineLengthKm,
  remainingDistanceKm,
} from "@/utils/geo";
import {
  GHOST_BUTTON_CLASS,
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
} from "@/utils/ui";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// ---- Tuning constants, all documented so they can be argued about. ----

// A fix further than this from the route counts as off route. Wide enough
// to absorb ordinary GPS error and a dual carriageway's width, narrow
// enough that a wrong exit is noticed within a few hundred metres.
const OFF_ROUTE_THRESHOLD_M = 150;
// Consecutive off-route fixes before acting, so one bad fix (under a
// bridge, in a cutting) never triggers a re-route.
const OFF_ROUTE_FIXES_REQUIRED = 3;
// Minimum gap between automatic re-route attempts, and a hard cap per
// session: each attempt is one call against a shared daily routing quota
// of 2,000 (see API.md), and a driver stuck somewhere strange should not
// be able to burn it silently.
const REROUTE_COOLDOWN_MS = 30_000;
const MAX_AUTOMATIC_REROUTES = 20;
// Within this distance of the next waypoint the "Arrived" action appears.
// Rest areas are big; 300 m covers the far end of a truck parking bay.
const ARRIVAL_RADIUS_KM = 0.3;
// Drive simulator: steady speed and the sideways offset "Go off route"
// applies (must exceed OFF_ROUTE_THRESHOLD_M comfortably).
const SIMULATED_SPEED_KMH = 80;
const SIMULATED_TICK_MS = 1000;
const SIMULATED_OFF_ROUTE_OFFSET_M = 400;

const TIME_FORMAT = new Intl.DateTimeFormat("en-AU", {
  weekday: "short",
  hour: "numeric",
  minute: "2-digit",
});

const subscribeNoop = () => () => {};
const getHydratedClient = () => true;
const getHydratedServer = () => false;

function readPlan(): NavigationPlan | null {
  try {
    const raw = localStorage.getItem(NAVIGATION_PLAN_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as NavigationPlan) : null;
  } catch {
    return null;
  }
}

function readProgress(): NavigationProgress {
  try {
    const raw = localStorage.getItem(NAVIGATION_PROGRESS_STORAGE_KEY);
    if (raw) {
      return JSON.parse(raw) as NavigationProgress;
    }
  } catch {
    // Fall through to a fresh start.
  }
  // The departure (index 0) is where the driver already is; the first
  // thing to reach is waypoint 1.
  return { nextWaypointIndex: 1, completedWaypointIds: [], rerouteCount: 0 };
}

function formatKm(km: number) {
  if (km < 1) {
    return `${Math.max(50, Math.round((km * 1000) / 50) * 50)} m`;
  }
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
}

function formatMinutes(totalMinutes: number) {
  const rounded = Math.max(0, Math.round(totalMinutes));
  const h = Math.floor(rounded / 60);
  const m = rounded % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} min`;
}

function restMinutes(plan: NavigationPlan, fromIndex: number) {
  return plan.waypoints.slice(fromIndex).reduce((sum, waypoint) => {
    if (!waypoint.restBreak) {
      return sum;
    }
    return (
      sum +
      (new Date(waypoint.restBreak.end).getTime() -
        new Date(waypoint.restBreak.start).getTime()) /
        60000
    );
  }, 0);
}

function getWaypointRestMinutes(waypoint: NavigationWaypoint): number | null {
  if (!waypoint.restBreak) {
    return null;
  }

  const start = new Date(waypoint.restBreak.start).getTime();
  const end = new Date(waypoint.restBreak.end).getTime();

  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) {
    return null;
  }

  return Math.round((end - start) / 60000);
}

function saveAfterRestStopFromWaypoint(waypoint: NavigationWaypoint) {
  saveSelectedAfterRestStop({
    id: waypoint.id,
    stopName: waypoint.name,
    requiredRestMins: getWaypointRestMinutes(waypoint),
    locationLabel: waypoint.name,
    coordinate: {
      lat: waypoint.lat,
      lng: waypoint.lng,
    },
  });
}

/** The step the driver is on, or the next one, for a position at
 * geometry index `index`. Steps cover [start_index, end_index]. */
function currentStep(steps: RouteStep[], index: number): RouteStep | null {
  for (const step of steps) {
    if (
      index < step.end_index ||
      (index === step.end_index && step.start_index === step.end_index)
    ) {
      return step;
    }
  }
  return steps.length > 0 ? steps[steps.length - 1] : null;
}

/**
 * In-app follow mode (BA item 2, the missing last step of the MVP flow).
 *
 * Why not hand off to Google or Apple Maps: both recompute the route with
 * car routing and neither offers truck restrictions to consumers in
 * Australia, so a low bridge or a weight-limited road near a rest area
 * could slip in. This page keeps the driver on the HGV route the app
 * computed, and when they leave it, re-routes through the app's own
 * backend so the truck constraints stay in force.
 *
 * Everything here runs on the device: the position never leaves the
 * browser except as the origin of a re-route request.
 */
export default function NavigatePage() {
  const router = useRouter();
  const hydrated = useSyncExternalStore(
    subscribeNoop,
    getHydratedClient,
    getHydratedServer,
  );

  const [plan, setPlan] = useState<NavigationPlan | null>(null);
  const [progress, setProgress] = useState<NavigationProgress>(readProgress);
  const [isPlanLoaded, setIsPlanLoaded] = useState(false);
  const fatigueWarningTimeoutRef = useRef<number | null>(null);
  const [showFatigueWarning, setShowFatigueWarning] = useState(false);

  const showDrowsinessWarning = useCallback(() => {
    setShowFatigueWarning(true);

    if (fatigueWarningTimeoutRef.current) {
      window.clearTimeout(fatigueWarningTimeoutRef.current);
    }

    fatigueWarningTimeoutRef.current = window.setTimeout(() => {
      setShowFatigueWarning(false);
      fatigueWarningTimeoutRef.current = null;
    }, 3000);
  }, []);

  useEffect(() => {
    return () => {
      if (fatigueWarningTimeoutRef.current) {
        window.clearTimeout(fatigueWarningTimeoutRef.current);
      }
    };
  }, []);

  // Read the plan after hydration so the server render and the first
  // client render match (same reasoning as the other pages).
  useEffect(() => {
    queueMicrotask(() => {
      setPlan(readPlan());
      setProgress(readProgress());
      setIsPlanLoaded(true);
    });
  }, []);

  // ---------------- Position: real GPS or the simulator ----------------
  const [position, setPosition] = useState<VehiclePosition | null>(null);
  const [positionError, setPositionError] = useState("");
  // Wall-clock time of the latest fix. Kept in state (not read via
  // Date.now() during render) so the ETA memo is a pure function of its
  // inputs and only moves when the position does.
  const [fixTime, setFixTime] = useState(0);
  const previousPositionRef = useRef<Coordinate | null>(null);

  // The simulator is only reachable through ?simulate=1. It replays the
  // planned geometry at a steady speed so the whole flow (instructions,
  // arrival, off-route re-routing) can be exercised and demonstrated
  // without driving a truck. Reading window.location in an effect (not
  // useSearchParams) keeps this page out of a Suspense boundary.
  const [isSimulationAvailable, setIsSimulationAvailable] = useState(false);
  const [isSimulating, setIsSimulating] = useState(false);
  const [isSimulatedOffRoute, setIsSimulatedOffRoute] = useState(false);
  const simulatedDistanceRef = useRef(0);

  useEffect(() => {
    queueMicrotask(() => {
      setIsSimulationAvailable(
        new URLSearchParams(window.location.search).get("simulate") === "1",
      );
    });
  }, []);

  const applyFix = useCallback((fix: Coordinate, heading?: number | null) => {
    const previous = previousPositionRef.current;
    const derivedHeading =
      heading !== null && heading !== undefined && !Number.isNaN(heading)
        ? heading
        : previous && haversineKm(previous, fix) > 0.01
          ? bearingDegrees(previous, fix)
          : undefined;
    previousPositionRef.current = fix;
    setPosition({ ...fix, heading: derivedHeading });
    setFixTime(Date.now());
  }, []);

  // Real GPS. Not started while simulating, and not started until the
  // plan exists (no point asking for permission on an empty page).
  useEffect(() => {
    if (!plan || isSimulating) {
      return;
    }
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      queueMicrotask(() =>
        setPositionError("This device does not provide location."),
      );
      return;
    }
    const watchId = navigator.geolocation.watchPosition(
      (geo) => {
        setPositionError("");
        applyFix(
          { lat: geo.coords.latitude, lng: geo.coords.longitude },
          geo.coords.heading,
        );
      },
      (error) => {
        setPositionError(
          error.code === error.PERMISSION_DENIED
            ? "Location access was denied. Allow location for this site to follow your position."
            : "Waiting for a location fix...",
        );
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [plan, isSimulating, applyFix]);

  // Simulator ticks.
  useEffect(() => {
    if (!plan || !isSimulating) {
      return;
    }
    const total = polylineLengthKm(plan.geometry);
    const interval = window.setInterval(() => {
      simulatedDistanceRef.current = Math.min(
        total,
        simulatedDistanceRef.current +
          (SIMULATED_SPEED_KMH * SIMULATED_TICK_MS) / 3_600_000,
      );
      const { point, bearing } = pointAtDistance(
        plan.geometry,
        simulatedDistanceRef.current,
      );
      const fix = isSimulatedOffRoute
        ? offsetMetres(point, bearing + 90, SIMULATED_OFF_ROUTE_OFFSET_M)
        : point;
      applyFix(fix, bearing);
    }, SIMULATED_TICK_MS);
    return () => window.clearInterval(interval);
  }, [plan, isSimulating, isSimulatedOffRoute, applyFix]);

  // Keep the screen on while navigating, where the browser allows it.
  useEffect(() => {
    if (
      !plan ||
      typeof navigator === "undefined" ||
      !("wakeLock" in navigator)
    ) {
      return;
    }
    let sentinel: WakeLockSentinel | null = null;
    navigator.wakeLock
      .request("screen")
      .then((lock) => {
        sentinel = lock;
      })
      .catch(() => {
        // Not granted (battery saver, background tab): nothing to do.
      });
    return () => {
      sentinel?.release().catch(() => {});
    };
  }, [plan]);

  // ---------------- Where on the route are we ----------------
  const [followMode, setFollowMode] = useState(true);

  const tracking = useMemo(() => {
    if (!plan || !position) {
      return null;
    }
    const nearest = nearestPointOnPolyline(plan.geometry, position);
    const remainingKm = remainingDistanceKm(
      plan.geometry,
      nearest.index,
      nearest.fraction,
    );
    const totalKm = polylineLengthKm(plan.geometry);
    const remainingDriveMinutes =
      totalKm > 0 ? (remainingKm / totalKm) * plan.durationHours * 60 : 0;

    const next = plan.waypoints[progress.nextWaypointIndex] ?? null;
    let toNextKm: number | null = null;
    if (next) {
      const nextNearest = nearestPointOnPolyline(plan.geometry, next);
      const alongToNext =
        remainingKm -
        remainingDistanceKm(
          plan.geometry,
          nextNearest.index,
          nextNearest.fraction,
        );
      // Along-route distance while the waypoint is still ahead; straight
      // line once we have passed its projection (e.g. a rest area just
      // off the highway).
      toNextKm = alongToNext > 0.05 ? alongToNext : haversineKm(position, next);
    }
    const step = currentStep(plan.steps, nearest.index);
    const toStepEndKm = step
      ? Math.max(
          0,
          remainingKm - remainingDistanceKm(plan.geometry, step.end_index, 0),
        )
      : null;

    const eta = new Date(
      fixTime +
        (remainingDriveMinutes +
          restMinutes(plan, progress.nextWaypointIndex)) *
          60000,
    );

    return {
      distanceToRouteM: nearest.distanceM,
      remainingKm,
      remainingDriveMinutes,
      next,
      toNextKm,
      step,
      toStepEndKm,
      eta,
    };
  }, [plan, position, fixTime, progress.nextWaypointIndex]);

  const isArrivedAtNext =
    tracking !== null &&
    tracking.next !== null &&
    haversineKm(position as Coordinate, tracking.next) <= ARRIVAL_RADIUS_KM;

  // ---------------- Off route and re-routing ----------------
  const [offRouteFixes, setOffRouteFixes] = useState(0);
  const [isRerouting, setIsRerouting] = useState(false);
  const [rerouteError, setRerouteError] = useState("");
  const lastRerouteAtRef = useRef(0);
  const rerouteInFlightRef = useRef(false);

  // Count consecutive off-route fixes; reset the moment a fix is back on
  // the line. Runs per position update, not per render.
  useEffect(() => {
    if (!tracking) {
      return;
    }
    const off = tracking.distanceToRouteM > OFF_ROUTE_THRESHOLD_M;
    queueMicrotask(() => setOffRouteFixes((count) => (off ? count + 1 : 0)));
  }, [tracking]);

  const isOffRoute = offRouteFixes >= OFF_ROUTE_FIXES_REQUIRED;

  const reroute = useCallback(async () => {
    if (!plan || !position || rerouteInFlightRef.current) {
      return;
    }
    rerouteInFlightRef.current = true;
    setIsRerouting(true);
    setRerouteError("");
    try {
      const remaining = plan.waypoints.slice(progress.nextWaypointIndex);
      if (remaining.length === 0) {
        return;
      }
      const response = await fetch(`${API_BASE_URL}/journeys/route`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          waypoints: [
            { lat: position.lat, lng: position.lng },
            ...remaining.map((waypoint) => ({
              lat: waypoint.lat,
              lng: waypoint.lng,
            })),
          ],
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setRerouteError(
          body?.detail ??
            "Could not re-plan from here. The previous route is still shown.",
        );
        return;
      }
      const data: {
        distance_km: number;
        duration_hours: number;
        geometry: Coordinate[];
        steps?: RouteStep[];
      } = await response.json();

      // The new route starts at the current position; the departure
      // waypoint is kept for the record but everything is measured
      // against the new geometry from now on.
      const updated: NavigationPlan = {
        ...plan,
        geometry: data.geometry,
        steps: data.steps ?? [],
        distanceKm: data.distance_km,
        durationHours: data.duration_hours,
      };
      const nextProgress: NavigationProgress = {
        ...progress,
        rerouteCount: progress.rerouteCount + 1,
      };
      setPlan(updated);
      setProgress(nextProgress);
      setOffRouteFixes(0);
      // The simulator's odometer is relative to the geometry, which has
      // just changed under it: restart it from the new route's start.
      simulatedDistanceRef.current = 0;
      setIsSimulatedOffRoute(false);
      try {
        localStorage.setItem(
          NAVIGATION_PLAN_STORAGE_KEY,
          JSON.stringify(updated),
        );
        localStorage.setItem(
          NAVIGATION_PROGRESS_STORAGE_KEY,
          JSON.stringify(nextProgress),
        );
      } catch {
        // Storage unavailable: the session still works, a reload won't resume.
      }
    } catch {
      setRerouteError(
        "Could not reach the routing service. The previous route is still shown.",
      );
    } finally {
      // The cooldown applies to failures too: a spot ORS cannot route
      // from (or an outage) must not turn into a request every few
      // seconds against the shared daily quota. The manual button
      // remains available regardless.
      lastRerouteAtRef.current = Date.now();
      rerouteInFlightRef.current = false;
      setIsRerouting(false);
    }
  }, [plan, position, progress]);

  // Automatic re-route, rate limited and capped.
  useEffect(() => {
    if (!isOffRoute || isRerouting) {
      return;
    }
    if (progress.rerouteCount >= MAX_AUTOMATIC_REROUTES) {
      return;
    }
    if (Date.now() - lastRerouteAtRef.current < REROUTE_COOLDOWN_MS) {
      return;
    }
    void reroute();
  }, [isOffRoute, isRerouting, progress.rerouteCount, reroute]);

  // ---------------- Actions ----------------
  function persistProgress(next: NavigationProgress) {
    setProgress(next);
    try {
      localStorage.setItem(
        NAVIGATION_PROGRESS_STORAGE_KEY,
        JSON.stringify(next),
      );
    } catch {
      // See above.
    }
  }

  function markArrived() {
    if (!plan || !tracking?.next) {
      return;
    }
    persistProgress({
      ...progress,
      nextWaypointIndex: progress.nextWaypointIndex + 1,
      completedWaypointIds: [
        ...progress.completedWaypointIds,
        tracking.next.id,
      ],
    });
  }

  function endNavigation() {
    try {
      localStorage.removeItem(NAVIGATION_PLAN_STORAGE_KEY);
      localStorage.removeItem(NAVIGATION_PROGRESS_STORAGE_KEY);
    } catch {
      // Nothing to clean up.
    }
    router.push("/route-breaks");
  }

  // ---------------- Map data ----------------
  const mapData: RouteBreaksData | null = useMemo(() => {
    if (!plan) {
      return null;
    }
    const departure =
      plan.waypoints.find((w) => w.kind === "departure") ?? null;
    return {
      routeGeometry: plan.geometry,
      departure: departure
        ? {
            label: departure.name,
            coordinate: { lat: departure.lat, lng: departure.lng },
          }
        : null,
      destinations: plan.waypoints
        .filter((w) => w.kind === "destination")
        .map((w) => ({
          label: w.name,
          coordinate: { lat: w.lat, lng: w.lng },
        })),
      restStops: plan.waypoints
        .filter((w) => w.kind === "stop")
        .map((w) => ({
          id: w.id,
          name: w.name,
          coordinate: { lat: w.lat, lng: w.lng },
          distanceKm: 0,
          estimatedArrivalTime: w.restBreak
            ? TIME_FORMAT.format(new Date(w.restBreak.start))
            : "",
          facilities: w.facilities ?? [],
          restBreak: w.restBreak ?? { start: "", end: "", reason: "" },
          isDriverSwitchLocation: false,
        })),
    };
  }, [plan]);

  const isJourneyComplete =
    plan !== null && progress.nextWaypointIndex >= plan.waypoints.length;

  if (!hydrated || !isPlanLoaded) {
    return (
      <main className="container mx-auto px-4 py-4" aria-busy="true">
        <div className="h-[60vh] rounded-xl bg-surface-alt" />
      </main>
    );
  }

  if (!plan || !mapData) {
    return (
      <main className="container mx-auto max-w-2xl px-4 py-6">
        <section className="rounded-xl border border-line bg-surface px-4 py-5">
          <h1 className="text-lg font-bold">No navigation plan</h1>
          <p className="mt-2 text-sm text-muted">
            Open your journey&apos;s Route &amp; Breaks page and tap Start
            Navigation first.
          </p>
          <Link href="/route-breaks" className={`mt-4 ${PRIMARY_BUTTON_CLASS}`}>
            Go to Route &amp; Breaks
          </Link>
        </section>
      </main>
    );
  }

  const finalDestination = plan.waypoints[plan.waypoints.length - 1];

  return (
    <main className="container mx-auto flex min-h-screen flex-col gap-3 px-4 py-3">
      {showFatigueWarning && (
        <div
          role="alert"
          className="fixed left-4 right-4 top-4 z-50 rounded-xl border border-danger-line bg-danger px-4 py-3 text-center text-sm font-bold text-white shadow-lg"
        >
          Fatigue warning detected. Prepare to rest safely.
        </div>
      )}

      <header className="flex items-center justify-between">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-muted">Navigating</p>
          <h1
            className="truncate text-xl font-bold"
            title={finalDestination.name}
          >
            To {finalDestination.shortName}
          </h1>
        </div>
        <button
          type="button"
          onClick={endNavigation}
          className={GHOST_BUTTON_CLASS}
        >
          End navigation
        </button>
      </header>

      {/* Instruction card: what to do next, in large type. */}
      <section
        aria-live="polite"
        className="rounded-xl border border-line bg-surface-alt px-4 py-3"
      >
        {isJourneyComplete ? (
          <div className="flex items-center gap-3">
            <Flag className="h-6 w-6 shrink-0 text-brand-strong" aria-hidden />
            <p className="text-lg font-bold text-ink">
              You have arrived at {finalDestination.shortName}.
            </p>
          </div>
        ) : tracking ? (
          <>
            {tracking.step ? (
              <div className="flex items-start gap-3">
                <CornerUpRight
                  className="mt-1 h-6 w-6 shrink-0 text-brand-strong"
                  aria-hidden
                />
                <div className="min-w-0">
                  <p className="text-lg font-bold leading-snug text-ink">
                    {tracking.step.instruction}
                  </p>
                  {tracking.toStepEndKm !== null && (
                    <p className="text-sm text-muted">
                      in {formatKm(tracking.toStepEndKm)}
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-lg font-bold text-ink">
                Follow the route on the map.
              </p>
            )}
            {tracking.next && (
              <div className="mt-3 flex items-start gap-3 border-t border-line pt-3">
                <MapPin
                  className="mt-0.5 h-5 w-5 shrink-0 text-brand"
                  aria-hidden
                />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink">
                    {tracking.next.kind === "stop"
                      ? "Next rest stop"
                      : "Next destination"}
                    :{" "}
                    <span title={tracking.next.name}>
                      {tracking.next.shortName}
                    </span>
                  </p>
                  <p className="text-sm text-muted">
                    {tracking.toNextKm !== null
                      ? formatKm(tracking.toNextKm)
                      : ""}
                    {tracking.next.restBreak && (
                      <>
                        {" "}
                        · rest{" "}
                        {formatMinutes(
                          (new Date(tracking.next.restBreak.end).getTime() -
                            new Date(tracking.next.restBreak.start).getTime()) /
                            60000,
                        )}
                      </>
                    )}
                  </p>
                  {tracking.next.kind === "stop" && (
                    <Link
                      href={`/after-rest?stopId=${encodeURIComponent(tracking.next.id)}`}
                      onClick={() =>
                        saveAfterRestStopFromWaypoint(tracking.next)
                      }
                      className="mt-3 inline-flex rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-ink"
                    >
                      After Rest Check
                    </Link>
                  )}
                </div>
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-muted">
            {positionError || "Waiting for your location..."}
          </p>
        )}
      </section>

      {/* Off-route banner. Never claims success it does not have. */}
      {isOffRoute && !isJourneyComplete && (
        <section
          role="alert"
          className="flex flex-col gap-2 rounded-xl border border-danger-line bg-danger-tint px-4 py-3 text-sm text-danger sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden />
            <span>
              {isRerouting
                ? "Off route. Re-planning a truck route from here..."
                : rerouteError
                  ? rerouteError
                  : progress.rerouteCount >= MAX_AUTOMATIC_REROUTES
                    ? "Off route. Automatic re-planning is paused for this journey."
                    : "Off route. Re-planning shortly..."}
            </span>
          </div>
          {!isRerouting && (
            <button
              type="button"
              onClick={() => void reroute()}
              className={SECONDARY_BUTTON_CLASS}
            >
              Re-plan from here
            </button>
          )}
        </section>
      )}

      <CameraMonitoringPreview onDrowsinessWarning={showDrowsinessWarning} />

      {/* Map with follow controls. */}
      <section className="relative">
        <RouteMap
          data={mapData}
          title={`${plan.waypoints[0].shortName} to ${finalDestination.shortName}`}
          initialCenter={{
            lat: plan.waypoints[0].lat,
            lng: plan.waypoints[0].lng,
          }}
          vehiclePosition={position}
          followMode={followMode && !isJourneyComplete}
          onUserInteraction={() => setFollowMode(false)}
          isRoutePending={isRerouting}
          className="h-[52vh] min-h-[320px]"
        />
        {!followMode && position && (
          <button
            type="button"
            onClick={() => setFollowMode(true)}
            className="absolute bottom-3 left-3 z-10 inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-sm font-semibold text-ink shadow"
          >
            <Crosshair className="h-4 w-4" aria-hidden />
            Re-centre
          </button>
        )}
      </section>

      {/* Trip figures and actions. */}
      <section className="grid grid-cols-3 gap-2">
        <div className="rounded-xl bg-surface-alt px-3 py-2">
          <p className="text-xs font-semibold uppercase text-muted">
            Remaining
          </p>
          <p className="text-base font-bold text-ink">
            {tracking ? formatKm(tracking.remainingKm) : "-"}
          </p>
        </div>
        <div className="rounded-xl bg-surface-alt px-3 py-2">
          <p className="text-xs font-semibold uppercase text-muted">
            Driving left
          </p>
          <p className="text-base font-bold text-ink">
            {tracking ? formatMinutes(tracking.remainingDriveMinutes) : "-"}
          </p>
        </div>
        <div className="rounded-xl bg-surface-alt px-3 py-2">
          <p className="text-xs font-semibold uppercase text-muted">Arrival</p>
          <p className="text-base font-bold text-ink">
            {tracking ? TIME_FORMAT.format(tracking.eta) : "-"}
          </p>
        </div>
      </section>

      {isArrivedAtNext &&
        tracking?.next &&
        !isJourneyComplete &&
        tracking.next.kind === "stop" && (
          <Link
            href={`/after-rest?stopId=${encodeURIComponent(tracking.next.id)}`}
            onClick={() => saveAfterRestStopFromWaypoint(tracking.next)}
            className={PRIMARY_BUTTON_CLASS}
          >
            Arrived at {tracking.next.shortName}, start after-rest check
          </Link>
        )}

      {isArrivedAtNext &&
        tracking?.next &&
        !isJourneyComplete &&
        tracking.next.kind !== "stop" && (
          <button
            type="button"
            onClick={markArrived}
            className={PRIMARY_BUTTON_CLASS}
          >
            Arrived at {tracking.next.shortName}
          </button>
        )}

      {isJourneyComplete && (
        <button
          type="button"
          onClick={endNavigation}
          className={PRIMARY_BUTTON_CLASS}
        >
          Finish journey
        </button>
      )}

      {progress.completedWaypointIds.length > 0 && !isJourneyComplete && (
        <p className="text-xs text-muted">
          {progress.completedWaypointIds.length} of {plan.waypoints.length - 1}{" "}
          stops reached
          {progress.rerouteCount > 0
            ? ` · re-planned ${progress.rerouteCount} time${progress.rerouteCount === 1 ? "" : "s"}`
            : ""}
        </p>
      )}

      {/* Simulator panel, only with ?simulate=1. */}
      {isSimulationAvailable && (
        <section className="rounded-xl border border-dashed border-line-strong px-4 py-3">
          <p className="text-xs font-bold uppercase tracking-wide text-muted">
            Simulation (testing only)
          </p>
          <p className="mt-1 text-xs text-muted">
            Replays the planned route at {SIMULATED_SPEED_KMH} km/h instead of
            using your real location.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setIsSimulating((value) => !value)}
              className={SECONDARY_BUTTON_CLASS}
            >
              {isSimulating ? "Pause simulation" : "Start simulation"}
            </button>
            <button
              type="button"
              disabled={!isSimulating}
              onClick={() => setIsSimulatedOffRoute((value) => !value)}
              className={`${GHOST_BUTTON_CLASS} disabled:opacity-50`}
            >
              {isSimulatedOffRoute ? "Back on route" : "Go off route"}
            </button>
          </div>
        </section>
      )}

      <Disclaimer className="mt-1" />
    </main>
  );
}
