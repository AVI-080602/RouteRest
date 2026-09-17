"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { AfterRestStopDetails } from "@/types/afterRest";
import {
  NAVIGATION_PLAN_STORAGE_KEY,
  NavigationPlan,
  NavigationWaypoint,
} from "@/types/navigation";
import { loadSelectedAfterRestStop } from "@/utils/afterRestStorage";

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

function getRequiredMinutes(stop: NavigationWaypoint): number | null {
  if (!stop.restBreak) {
    return null;
  }

  const startTime = new Date(stop.restBreak.start).getTime();
  const endTime = new Date(stop.restBreak.end).getTime();

  if (Number.isNaN(startTime) || Number.isNaN(endTime)) {
    return null;
  }

  return Math.round((endTime - startTime) / 60000);
}

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

export default function AfterRestPage() {
  const searchParams = useSearchParams();
  const stopId = searchParams.get("stopId");
  const [navigationPlan, setNavigationPlan] = useState<NavigationPlan | null>(
    null,
  );
  const [savedStop, setSavedStop] = useState<AfterRestStopDetails | null>(null);
  const [hasLoadedPlan, setHasLoadedPlan] = useState(false);

  useEffect(() => {
    queueMicrotask(() => {
      setNavigationPlan(loadNavigationPlan());
      setSavedStop(loadSelectedAfterRestStop(stopId));
      setHasLoadedPlan(true);
    });
  }, [stopId]);

  const selectedStop = navigationPlan?.waypoints.find(
    (waypoint) => waypoint.kind === "stop" && waypoint.id === stopId,
  );
  const stopDetails =
    savedStop ?? (selectedStop ? waypointToAfterRestStop(selectedStop) : null);

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
    <main className="container mx-auto px-4 py-6">
      <section className="rounded-xl border border-line bg-surface px-4 py-5">
        <p className="text-sm font-semibold text-brand">After Rest</p>
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
        </div>

        <Link
          href="/route-breaks"
          className="mt-6 inline-flex rounded-lg border border-line px-4 py-2 font-semibold text-ink"
        >
          Back
        </Link>
      </section>
    </main>
  );
}
