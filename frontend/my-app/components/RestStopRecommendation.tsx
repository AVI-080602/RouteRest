"use client";

import { useState } from "react";
import {
  AlertTriangle,
  Clock,
  LoaderCircle,
  MapPin,
  Navigation as NavigationIcon,
  Ruler,
} from "lucide-react";

import { JourneyDetails } from "@/types/journeyDetails";
import {
  NAVIGATION_PLAN_STORAGE_KEY,
  NAVIGATION_PROGRESS_STORAGE_KEY,
  NavigationPlan,
  NavigationProgress,
  NavigationWaypoint,
  RouteStep,
} from "@/types/navigation";
import { Coordinate } from "@/types/routeBreaks";
import { RankedStop, rankStops } from "@/utils/rankStops";
import {
  buildJourneyNeeds,
  getStopUnsuitableReasons,
} from "@/utils/updateStopRecommendations";
import { PRIMARY_BUTTON_CLASS } from "@/utils/ui";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

const ASSUMED_SEARCH_SPEED_KMH = 60;

type CandidateResponse = {
  name: string;
  road_name?: string | null;
  coordinate: Coordinate;
  distance_km: number;
  facilities: string[];
};

type RankedCandidate = RankedStop & {
  coordinate: Coordinate;
};

type RouteResponse = {
  distance_km: number;
  duration_hours: number;
  geometry: Coordinate[];
  steps?: RouteStep[];
};

type RestRecommendation = {
  id: string;
  name: string;
  coordinate: Coordinate;
  distanceKm: number;
  travelMinutes: number;
  facilities: string[];
};

function candidateToRankedStop(
  candidate: CandidateResponse,
  index: number,
): RankedCandidate {
  return {
    id: `rest-action-${index}-${candidate.coordinate.lat}-${candidate.coordinate.lng}`,
    name: candidate.name,
    coordinate: candidate.coordinate,
    score: 0,
    rankingReasons: [],
    isHeavyVehicleSuitable: true,
    hasLighting: candidate.facilities.includes("Lighting"),
    hasHeavyVehicleParking: true,

    // The database confirms that fuel may be available, but it does not
    // confirm the exact fuel type.
    fuelTypes: [],

    minutesFromRecommendedRest: Math.round(
      (candidate.distance_km / ASSUMED_SEARCH_SPEED_KMH) * 60,
    ),
    detourDistanceKm: candidate.distance_km,
    facilities: candidate.facilities,
  };
}

function formatTravelTime(minutes: number): string {
  const roundedMinutes = Math.max(1, Math.round(minutes));

  if (roundedMinutes < 60) {
    return `${roundedMinutes} min`;
  }

  const hours = Math.floor(roundedMinutes / 60);
  const remainingMinutes = roundedMinutes % 60;

  if (remainingMinutes === 0) {
    return `${hours} h`;
  }

  return `${hours} h ${remainingMinutes} min`;
}

function isValidRoute(route: RouteResponse): boolean {
  return (
    Number.isFinite(route.distance_km) &&
    route.distance_km >= 0 &&
    Number.isFinite(route.duration_hours) &&
    route.duration_hours >= 0 &&
    Array.isArray(route.geometry) &&
    route.geometry.length >= 2
  );
}
function loadNavigationPlan(): NavigationPlan | null {
  const rawPlan = localStorage.getItem(
    NAVIGATION_PLAN_STORAGE_KEY,
  );

  if (!rawPlan) {
    return null;
  }

  try {
    return JSON.parse(rawPlan) as NavigationPlan;
  } catch {
    return null;
  }
}

function loadNavigationProgress(): NavigationProgress | null {
  const rawProgress = localStorage.getItem(
    NAVIGATION_PROGRESS_STORAGE_KEY,
  );

  if (!rawProgress) {
    return null;
  }

  try {
    return JSON.parse(rawProgress) as NavigationProgress;
  } catch {
    return null;
  }
}
async function retrieveRoute(
  waypoints: Coordinate[],
): Promise<RouteResponse> {
  if (waypoints.length < 2) {
    throw new Error("At least two route points are required");
  }

  const response = await fetch(`${API_BASE_URL}/journeys/route`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      waypoints: waypoints.map((waypoint) => ({
        lat: waypoint.lat,
        lng: waypoint.lng,
      })),
    }),
  });

  if (!response.ok) {
    throw new Error("Route retrieval failed");
  }

  const route = (await response.json()) as RouteResponse;

  if (!isValidRoute(route)) {
    throw new Error("Invalid route information");
  }

  return route;
}

export default function RestStopRecommendation({
  position,
  journeyDetails,
}: {
  position: Coordinate | null;
  journeyDetails: JourneyDetails | null;
}) {
  const [recommendation, setRecommendation] =
    useState<RestRecommendation | null>(null);

  const [searchError, setSearchError] = useState("");
  const [navigationError, setNavigationError] = useState("");

  const [isLoading, setIsLoading] = useState(false);
  const [isStartingNavigation, setIsStartingNavigation] = useState(false);

  async function findNearestSuitableStop() {
    setRecommendation(null);
    setSearchError("");
    setNavigationError("");

    if (!position) {
      setSearchError(
        "Your current location is unavailable, so a suitable rest stop cannot be confirmed.",
      );
      return;
    }

    if (!journeyDetails) {
      setSearchError(
        "Journey information is unavailable, so a suitable rest stop cannot be confirmed.",
      );
      return;
    }

    setIsLoading(true);

    try {
      const candidatesResponse = await fetch(
        `${API_BASE_URL}/journeys/rest-stops/candidates`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            lat: position.lat,
            lng: position.lng,
            radius_km: 100,
            limit: 10,
          }),
        },
      );

      if (!candidatesResponse.ok) {
        throw new Error("Candidate search failed");
      }

      const candidateData =
        (await candidatesResponse.json()) as CandidateResponse[];

      if (candidateData.length === 0) {
        setSearchError(
          "No suitable heavy-vehicle rest stop could be confirmed.",
        );
        return;
      }

      const candidates = candidateData.map(candidateToRankedStop);

      const journeyNeeds = buildJourneyNeeds(journeyDetails, {
        restDueSoon: true,
      });

      const rankedCandidates = rankStops(
        candidates,
        journeyNeeds,
      ) as RankedCandidate[];

      const suitableCandidates = rankedCandidates.filter(
        (candidate) =>
          getStopUnsuitableReasons(candidate, journeyNeeds).length === 0,
      );

      if (suitableCandidates.length === 0) {
        setSearchError(
          "Nearby stops were found, but none could be confirmed as suitable for the current Journey.",
        );
        return;
      }

      const selectedCandidate = [...suitableCandidates].sort(
        (first, second) =>
          first.detourDistanceKm - second.detourDistanceKm ||
          second.score - first.score,
      )[0];

      const route = await retrieveRoute([
        position,
        selectedCandidate.coordinate,
      ]);

      setRecommendation({
        id: selectedCandidate.id,
        name: selectedCandidate.name,
        coordinate: selectedCandidate.coordinate,
        distanceKm: route.distance_km,
        travelMinutes: route.duration_hours * 60,
        facilities: selectedCandidate.facilities,
      });
    } catch {
      setSearchError(
        "A suitable rest stop cannot be confirmed because the stop or route information is unavailable.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function startNavigation() {
    setNavigationError("");

    if (!recommendation) {
      setNavigationError(
        "Select a suitable rest stop before updating the route.",
      );
      return;
    }

    if (!position) {
      setNavigationError(
        "The route cannot be updated because your current location is unavailable.",
      );
      return;
    }

    if (!journeyDetails) {
      setNavigationError(
        "The route cannot be updated because your Journey information is unavailable.",
      );
      return;
    }

    const existingPlan = loadNavigationPlan();
    const existingProgress = loadNavigationProgress();

    if (!existingPlan || !existingProgress) {
      setNavigationError(
        "The current navigation plan or progress is unavailable. The existing route has not been changed.",
      );
      return;
    }

    setIsStartingNavigation(true);

    try {
      const insertionIndex = Math.min(
        Math.max(existingProgress.nextWaypointIndex, 1),
        existingPlan.waypoints.length,
      );

      // Preserve every future stop and destination. If this exact
      // recommendation was already inserted but not yet reached, replace
      // that copy instead of adding a duplicate.
      const remainingWaypoints = existingPlan.waypoints
        .slice(insertionIndex)
        .filter(
          (waypoint) =>
            waypoint.id !== recommendation.id &&
            !waypoint.id.startsWith(
              `${recommendation.id}-`,
            ),
        );

      const recommendedWaypoint: NavigationWaypoint = {
        lat: recommendation.coordinate.lat,
        lng: recommendation.coordinate.lng,
        kind: "stop",
        id: `${recommendation.id}-${Date.now()}`,
        name: recommendation.name,
        shortName: recommendation.name,
        facilities: recommendation.facilities,
      };

      // Request one continuous route:
      // current position -> recommended stop -> all remaining waypoints.
      const route = await retrieveRoute([
        position,
        recommendation.coordinate,
        ...remainingWaypoints.map((waypoint) => ({
          lat: waypoint.lat,
          lng: waypoint.lng,
        })),
      ]);

      const updatedPlan: NavigationPlan = {
        ...existingPlan,
        waypoints: [
          ...existingPlan.waypoints.slice(0, insertionIndex),
          recommendedWaypoint,
          ...remainingWaypoints,
        ],
        geometry: route.geometry,
        steps: route.steps ?? [],
        distanceKm: route.distance_km,
        durationHours: route.duration_hours,

        // Keep the original departureDateTime and createdAt.
        // This remains the same journey, not a new journey.
      };

      localStorage.setItem(
        NAVIGATION_PLAN_STORAGE_KEY,
        JSON.stringify(updatedPlan),
      );

      // Preserve the existing completed stops, next waypoint index and
      // reroute count. Do not remove or reset progress.
      localStorage.setItem(
        NAVIGATION_PROGRESS_STORAGE_KEY,
        JSON.stringify(existingProgress),
      );

      window.location.reload();
    } catch {
      setNavigationError(
        "The recommended rest stop could not be added to the current route. The existing journey has been retained.",
      );
      setIsStartingNavigation(false);
    }
  }

  return (
    <section
      aria-labelledby="rest-recommendation-heading"
      className="rounded-xl border border-line bg-surface-alt px-4 py-4"
    >
      <div className="flex items-start gap-3">
        <MapPin
          className="mt-0.5 h-6 w-6 shrink-0 text-brand"
          aria-hidden
        />

        <div className="min-w-0 flex-1">
          <h2 id="rest-recommendation-heading" className="font-bold text-ink">
            Need to rest now?
          </h2>

          <p className="mt-1 text-sm text-muted">
            Find the nearest confirmed heavy-vehicle rest stop from your
            current location.
          </p>
        </div>
      </div>

      <button
        type="button"
        disabled={isLoading || !position || !journeyDetails}
        onClick={() => void findNearestSuitableStop()}
        className={`${PRIMARY_BUTTON_CLASS} mt-3 w-full disabled:cursor-not-allowed disabled:opacity-50`}
      >
        {isLoading ? (
          <>
            <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
            Finding a suitable stop...
          </>
        ) : (
          "Find nearest suitable rest stop"
        )}
      </button>

      {!position && (
        <p className="mt-2 text-sm text-muted">
          Waiting for your current location.
        </p>
      )}

      {position && !journeyDetails && (
        <p className="mt-2 text-sm text-muted">
          Waiting for your Journey information.
        </p>
      )}

      {recommendation && (
        <div
          aria-live="polite"
          className="mt-4 rounded-xl border border-brand bg-surface px-3 py-3"
        >
          <p className="text-xs font-bold uppercase text-brand-strong">
            Nearest suitable stop
          </p>

          <h3 className="mt-1 text-lg font-bold text-ink">
            {recommendation.name}
          </h3>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="rounded-lg bg-surface-alt px-3 py-2">
              <div className="flex items-center gap-2 text-muted">
                <Clock className="h-4 w-4" aria-hidden />

                <span className="text-xs font-semibold uppercase">
                  Travel time
                </span>
              </div>

              <p className="mt-1 font-bold text-ink">
                {formatTravelTime(recommendation.travelMinutes)}
              </p>
            </div>

            <div className="rounded-lg bg-surface-alt px-3 py-2">
              <div className="flex items-center gap-2 text-muted">
                <Ruler className="h-4 w-4" aria-hidden />

                <span className="text-xs font-semibold uppercase">
                  Distance
                </span>
              </div>

              <p className="mt-1 font-bold text-ink">
                {recommendation.distanceKm < 10
                  ? recommendation.distanceKm.toFixed(1)
                  : Math.round(recommendation.distanceKm)}{" "}
                km
              </p>
            </div>
          </div>

          <div className="mt-3">
            <p className="text-xs font-bold uppercase text-muted">
              Confirmed facilities
            </p>

            {recommendation.facilities.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {recommendation.facilities.map((facility) => (
                  <span
                    key={facility}
                    className="rounded-full bg-brand-tint px-2 py-1 text-xs font-semibold text-brand-strong"
                  >
                    {facility}
                  </span>
                ))}
              </div>
            ) : (
              <p className="mt-1 text-sm text-muted">
                No additional facilities are confirmed.
              </p>
            )}
          </div>

          <button
            type="button"
            disabled={isStartingNavigation}
            onClick={() => void startNavigation()}
            className={`${PRIMARY_BUTTON_CLASS} mt-4 w-full disabled:cursor-not-allowed disabled:opacity-50`}
          >
            {isStartingNavigation ? (
              <>
                <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
                Updating route...
              </>
            ) : (
              <>
                <NavigationIcon className="h-4 w-4" aria-hidden />
                Add as Next Rest Stop
              </>
            )}
          </button>
        </div>
      )}

      {searchError && (
        <div
          role="alert"
          className="mt-4 rounded-xl border border-danger-line bg-danger-tint px-3 py-3 text-danger"
        >
          <div className="flex items-start gap-2">
            <AlertTriangle
              className="mt-0.5 h-5 w-5 shrink-0"
              aria-hidden
            />

            <div>
              <p className="text-sm font-bold">{searchError}</p>

              <p className="mt-1 text-sm">
                Do not continue driving while sleepy. Stop only when and where
                it is legal and safe to do so.
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={isLoading}
            onClick={() => void findNearestSuitableStop()}
            className="mt-3 rounded-lg border border-danger-line bg-surface px-3 py-2 text-sm font-semibold text-danger disabled:opacity-50"
          >
            Retry
          </button>
        </div>
      )}

      {navigationError && recommendation && (
        <div
          role="alert"
          className="mt-4 rounded-xl border border-danger-line bg-danger-tint px-3 py-3 text-danger"
        >
          <div className="flex items-start gap-2">
            <AlertTriangle
              className="mt-0.5 h-5 w-5 shrink-0"
              aria-hidden
            />

            <div>
              <p className="text-sm font-bold">{navigationError}</p>

              <p className="mt-1 text-sm">
                Check the connection and try again. The selected rest stop has
                not been removed.
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={isStartingNavigation}
            onClick={() => void startNavigation()}
            className="mt-3 rounded-lg border border-danger-line bg-surface px-3 py-2 text-sm font-semibold text-danger disabled:opacity-50"
          >
            {isStartingNavigation ? "Retrying..." : "Retry Route Update"}
          </button>
        </div>
      )}
    </section>
  );
}