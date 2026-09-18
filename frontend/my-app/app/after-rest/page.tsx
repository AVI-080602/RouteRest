"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { AfterRestRecord, AfterRestStopDetails } from "@/types/afterRest";
import {
  NAVIGATION_PLAN_STORAGE_KEY,
  NAVIGATION_PROGRESS_STORAGE_KEY,
  NavigationPlan,
  NavigationProgress,
  NavigationWaypoint,
} from "@/types/navigation";
import {
  getAfterRestRecordById,
  loadSelectedAfterRestStop,
  saveAfterRestRecord,
} from "@/utils/afterRestStorage";

/**
 * Loads the navigation plan from local storage.
 * @returns The loaded navigation plan, or null if none is found.
 */
function loadNavigationPlan(): NavigationPlan | null {
  if (typeof window === "undefined") {
    return null;
  }

  const rawPlan = localStorage.getItem(NAVIGATION_PLAN_STORAGE_KEY);

  if (!rawPlan) {
    return null;
  }

  try {
    return JSON.parse(rawPlan) as NavigationPlan;
  } catch {
    return null;
  }
}

/**
 * Loads the navigation progress from local storage.
 * @returns The loaded navigation progress, or a fresh record if none is found.
 */
function loadNavigationProgress(): NavigationProgress {
  try {
    const rawProgress = localStorage.getItem(NAVIGATION_PROGRESS_STORAGE_KEY);

    if (rawProgress) {
      return JSON.parse(rawProgress) as NavigationProgress;
    }
  } catch {
    // Fall back to a fresh navigation progress record.
  }

  return { nextWaypointIndex: 1, completedWaypointIds: [], rerouteCount: 0 };
}
/**
 * Gets the required rest duration for a given rest stop.
 * @param stop The navigation waypoint representing the rest stop.
 * @returns The required rest duration in minutes, or null if not applicable.
 */
function getRequiredMinutes(stop: NavigationWaypoint): number | null {
  if (!stop.restBreak) {
    return null;
  }

  const startTime = new Date(stop.restBreak.start).getTime();
  const endTime = new Date(stop.restBreak.end).getTime();

  if (Number.isNaN(startTime) || Number.isNaN(endTime)) {
    return null;
  }
  // Calculate the required rest duration in minutes.
  return Math.round((endTime - startTime) / 60000);
}

/**
 * Converts a navigation waypoint to after-rest stop details.
 * @param stop The navigation waypoint representing the rest stop.
 * @returns The after-rest stop details derived from the waypoint.
 */
function waypointToAfterRestStop(
  stop: NavigationWaypoint,
): AfterRestStopDetails {
  return {
    id: stop.id,
    stopName: stop.name,
    requiredRestMins: getRequiredMinutes(stop),
    locationLabel: stop.name,
    coordinate: {
      lat: stop.lat,
      lng: stop.lng,
    },
  };
}

function AfterRestContent() {
  const searchParams = useSearchParams();
  const stopId = searchParams.get("stopId");
  const [navigationPlan, setNavigationPlan] = useState<NavigationPlan | null>(
    null,
  );
  const [savedStop, setSavedStop] = useState<AfterRestStopDetails | null>(null);
  const [afterRestRecord, setAfterRestRecord] =
    useState<AfterRestRecord | null>(null);
  const [restResult, setRestResult] = useState<"short" | "met" | null>(null);
  const [hasLoadedPlan, setHasLoadedPlan] = useState(false);

  /**
   * Loads the navigation plan and the selected after-rest stop from local storage.
   * Also retrieves the after-rest record for the current stop if available.
   */
  useEffect(() => {
    queueMicrotask(() => {
      setNavigationPlan(loadNavigationPlan());
      setSavedStop(loadSelectedAfterRestStop(stopId));

      if (stopId) {
        setAfterRestRecord(getAfterRestRecordById(stopId) ?? null);
      }

      setHasLoadedPlan(true);
    });
  }, [stopId]);

  // Find the selected stop from the navigation plan.
  const selectedStop = navigationPlan?.waypoints.find(
    (waypoint) => waypoint.kind === "stop" && waypoint.id === stopId,
  );

  // Derive the after-rest stop details, either from the saved stop or by converting the selected navigation waypoint.
  const stopDetails =
    savedStop ?? (selectedStop ? waypointToAfterRestStop(selectedStop) : null);
  const activeRestInProgress =
    afterRestRecord?.punchInAt !== null &&
    afterRestRecord?.punchInAt !== undefined &&
    afterRestRecord.punchOutAt === null;
  const remainingRestMins =
    afterRestRecord?.actualRestMins !== null &&
    afterRestRecord?.actualRestMins !== undefined &&
    afterRestRecord.requiredRestMins !== null
      ? Math.max(
          afterRestRecord.requiredRestMins - afterRestRecord.actualRestMins,
          0,
        )
      : null;

  // Determine if the driver is currently in an active rest session and calculate the remaining rest minutes.
  function handlePunchIn() {
    if (!stopDetails) {
      return;
    }

    const record: AfterRestRecord = {
      id: stopDetails.id,
      stopName: stopDetails.stopName,
      requiredRestMins: stopDetails.requiredRestMins,
      punchInAt: Date.now(),
      punchOutAt: null,
      actualRestMins: afterRestRecord?.actualRestMins ?? null,
      completed: false,
      locationLabel: stopDetails.locationLabel,
      coordinate: stopDetails.coordinate,
    };

    saveAfterRestRecord(record);
    setAfterRestRecord(record);
  }
  
  // Handles the punch-out action for ending a rest session.
  function handlePunchOut() {
    if (!afterRestRecord?.punchInAt) {
      return;
    }

    const punchOutAt = Date.now();
    const restSessionMins = Math.max(
      0,
      Math.round((punchOutAt - afterRestRecord.punchInAt) / 60000),
    );
    const actualRestMins =
      (afterRestRecord.actualRestMins ?? 0) + restSessionMins;
    const completed =
      afterRestRecord.requiredRestMins !== null &&
      actualRestMins >= afterRestRecord.requiredRestMins;
    const updatedRecord: AfterRestRecord = {
      ...afterRestRecord,
      punchOutAt,
      actualRestMins,
      completed,
    };

    saveAfterRestRecord(updatedRecord);
    setAfterRestRecord(updatedRecord);

    if (afterRestRecord.requiredRestMins !== null) {
      setRestResult(completed ? "met" : "short");
    }
  }

  // Marks the current rest stop as reached in the navigation progress.
  function markRestStopReached() {
    if (!stopId || !navigationPlan) {
      return;
    }

    const stopIndex = navigationPlan.waypoints.findIndex(
      (waypoint) => waypoint.id === stopId && waypoint.kind === "stop",
    );

    if (stopIndex === -1) {
      return;
    }

    const progress = loadNavigationProgress();
    const updatedProgress: NavigationProgress = {
      ...progress,
      nextWaypointIndex: Math.max(progress.nextWaypointIndex, stopIndex + 1),
      completedWaypointIds: progress.completedWaypointIds.includes(stopId)
        ? progress.completedWaypointIds
        : [...progress.completedWaypointIds, stopId],
    };

    localStorage.setItem(
      NAVIGATION_PROGRESS_STORAGE_KEY,
      JSON.stringify(updatedProgress),
    );
  }

  if (!hasLoadedPlan) {
    return (
      <main className="container mx-auto px-4 py-6">
        <section className="rounded-xl border border-line bg-surface px-4 py-5">
          <h1 className="text-xl font-bold text-ink">After Rest</h1>
          <p className="mt-3 text-sm text-muted">
            Loading rest stop information...
          </p>
        </section>
      </main>
    );
  }

  if (!stopId || !stopDetails) {
    return (
      <main className="container mx-auto px-4 py-6">
        <section className="rounded-xl border border-line bg-surface px-4 py-5">
          <h1 className="text-xl font-bold text-ink">After Rest</h1>
          <p className="mt-3 text-sm text-muted">
            Rest stop information could not be found.
          </p>
          <Link
            href="/route-breaks"
            className="mt-5 inline-flex rounded-lg bg-brand px-4 py-2 font-semibold text-white"
          >
            Back to Route &amp; Breaks
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="container relative mx-auto flex min-h-screen items-center justify-center px-4 py-6">
      <Link
        href="/route-breaks"
        className="absolute right-4 top-4 inline-flex rounded-lg border border-line px-4 py-2 text-sm font-semibold text-ink"
      >
        Back
      </Link>

      <section className="w-full max-w-2xl rounded-xl border border-line bg-surface px-4 py-5">
        <p className="text-center text-sm font-semibold text-brand">
          After Rest
        </p>
        <h1 className="mt-2 text-2xl font-bold text-ink">
          {stopDetails.stopName}
        </h1>

        <div className="mt-5 space-y-3 text-sm text-muted">
          <p>
            <span className="font-semibold text-ink">Required rest:</span>{" "}
            {stopDetails.requiredRestMins === null
              ? "Not available"
              : `${stopDetails.requiredRestMins} minutes`}
          </p>

          {stopDetails.coordinate && (
            <p>
              <span className="font-semibold text-ink">Location:</span>{" "}
              {stopDetails.coordinate.lat.toFixed(4)},{" "}
              {stopDetails.coordinate.lng.toFixed(4)}
            </p>
          )}

          {afterRestRecord?.punchInAt && (
            <p>
              <span className="font-semibold text-ink">Punch in:</span>{" "}
              {new Date(afterRestRecord.punchInAt).toLocaleString()}
            </p>
          )}

          {afterRestRecord?.punchOutAt && (
            <p>
              <span className="font-semibold text-ink">Punch out:</span>{" "}
              {new Date(afterRestRecord.punchOutAt).toLocaleString()}
            </p>
          )}

          {afterRestRecord?.actualRestMins !== null &&
            afterRestRecord?.actualRestMins !== undefined && (
              <p>
                <span className="font-semibold text-ink">Actual rest:</span>{" "}
                {afterRestRecord.actualRestMins} minutes
              </p>
            )}

          {afterRestRecord?.completed && (
            <p className="rounded-lg bg-brand-tint px-3 py-2 font-semibold text-brand-strong">
              Good to drive. Your planned rest requirement has been met.
            </p>
          )}
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handlePunchIn}
            disabled={activeRestInProgress}
            className="inline-flex rounded-lg bg-brand px-4 py-2 font-semibold text-white disabled:opacity-60"
          >
            {activeRestInProgress
              ? "Rest Started"
              : afterRestRecord?.punchOutAt
                ? "Punch In Again"
                : "Punch In"}
          </button>

          {activeRestInProgress && (
            <button
              type="button"
              onClick={handlePunchOut}
              className="inline-flex rounded-lg bg-brand px-4 py-2 font-semibold text-white"
            >
              Punch Out
            </button>
          )}
        </div>
      </section>

      {restResult && afterRestRecord && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="rest-result-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
        >
          <section className="w-full max-w-md rounded-xl bg-surface px-5 py-5 shadow-lg">
            <h2 id="rest-result-title" className="text-xl font-bold text-ink">
              {restResult === "met"
                ? "Good to drive"
                : "A little more rest is recommended"}
            </h2>
            <p className="mt-3 text-sm text-muted">
              {restResult === "met"
                ? `You have rested for ${afterRestRecord.actualRestMins ?? 0} minutes, which meets the planned rest for this stop.`
                : `You have rested for ${afterRestRecord.actualRestMins ?? 0} minutes. Taking ${remainingRestMins ?? 0} more minutes would better match the planned rest for this stop.`}
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Link
                href="/navigate"
                onClick={markRestStopReached}
                className="inline-flex rounded-lg bg-brand px-4 py-2 font-semibold text-white"
              >
                Continue Driving
              </Link>
              <button
                type="button"
                onClick={() => setRestResult(null)}
                className="inline-flex rounded-lg border border-line px-4 py-2 font-semibold text-ink"
              >
                Take Longer Rest
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

export default function AfterRestPage() {
  return (
    <Suspense
      fallback={
        <main className="container mx-auto px-4 py-6">
          <section className="rounded-xl border border-line bg-surface px-4 py-5">
            <h1 className="text-xl font-bold text-ink">After Rest</h1>
            <p className="mt-3 text-sm text-muted">
              Loading rest stop information...
            </p>
          </section>
        </main>
      }
    >
      <AfterRestContent />
    </Suspense>
  );
}
