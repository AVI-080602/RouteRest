"use client";

import { useEffect, useState } from "react";
import type { JourneySafetySummary } from "@/types/journeyPerformance";
import { loadJourneySafetySummary } from "@/utils/journeyPerformanceStorage";

const DATE_TIME_FORMAT = new Intl.DateTimeFormat("en-AU", {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatMinutes(totalMinutes: number) {
  const roundedMinutes = Math.max(
    0,
    Math.round(totalMinutes),
  );

  const hours = Math.floor(roundedMinutes / 60);
  const minutes = roundedMinutes % 60;

  if (hours === 0) {
    return `${minutes} min`;
  }

  if (minutes === 0) {
    return `${hours} h`;
  }

  return `${hours} h ${minutes} min`;
}

function buildRestSummary(summary: JourneySafetySummary) {
  if (summary.plannedRestStops === 0) {
    return "The completed journey did not include a planned rest stop.";
  }

  if (
    summary.completedRestStops ===
    summary.plannedRestStops
  ) {
    return "All planned rest stops were recorded as completed.";
  }

  return `${summary.completedRestStops} of ${summary.plannedRestStops} planned rest stops were recorded as completed.`;
}

export default function PerformancePage() {
  const [summary, setSummary] =
    useState<JourneySafetySummary | null>(null);

  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    queueMicrotask(() => {
      setSummary(loadJourneySafetySummary());
      setIsLoaded(true);
    });
  }, []);

  if (!isLoaded) {
    return (
      <main
        className="container mx-auto max-w-2xl px-4 py-6"
        aria-busy="true"
      >
        <div className="h-64 rounded-xl bg-surface-alt" />
      </main>
    );
  }

  if (!summary) {
    return (
      <main className="container mx-auto max-w-2xl px-4 py-6">
        <section className="rounded-xl border border-line bg-surface px-4 py-5">
          <p className="text-sm font-semibold text-muted">
            Journey Performance
          </p>

          <h1 className="mt-1 text-2xl font-bold text-ink">
            No completed journey
          </h1>

          <p className="mt-3 text-sm text-muted">
            Complete a journey before opening the performance
            summary.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="container mx-auto max-w-2xl px-4 py-6">
      <section className="rounded-xl border border-line bg-surface px-4 py-5">
        <p className="text-sm font-semibold text-muted">
          Journey Performance
        </p>

        <h1 className="mt-1 text-2xl font-bold text-ink">
          Journey Safety Summary
        </h1>

        <p className="mt-2 text-sm text-muted">
          A concise summary of the latest completed journey,
          based on navigation and confirmed rest records saved on
          this device.
        </p>

        <div className="mt-5 rounded-xl bg-surface-alt px-4 py-4">
          <p className="text-sm font-semibold text-ink">
            {summary.departureName} to{" "}
            {summary.destinationNames.length > 0
              ? summary.destinationNames.join(", ")
              : "Destination"}
          </p>

          <p className="mt-1 text-sm text-muted">
            Completed:{" "}
            {DATE_TIME_FORMAT.format(
              new Date(summary.completedAt),
            )}
          </p>

          <p className="mt-1 text-sm text-muted">
            Planned distance:{" "}
            {summary.plannedDistanceKm.toFixed(1)} km
          </p>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-line px-4 py-3">
            <p className="text-xs font-semibold uppercase text-muted">
              Planned rests completed
            </p>

            <p className="mt-1 text-xl font-bold text-ink">
              {summary.completedRestStops}/
              {summary.plannedRestStops}
            </p>
          </div>

          <div className="rounded-xl border border-line px-4 py-3">
            <p className="text-xs font-semibold uppercase text-muted">
              Confirmed rest
            </p>

            <p className="mt-1 text-xl font-bold text-ink">
              {formatMinutes(summary.confirmedRestMinutes)}
            </p>
          </div>

          <div className="rounded-xl border border-line px-4 py-3">
            <p className="text-xs font-semibold uppercase text-muted">
              Route updates
            </p>

            <p className="mt-1 text-xl font-bold text-ink">
              {summary.rerouteCount}
            </p>
          </div>

          <div className="rounded-xl border border-line px-4 py-3">
            <p className="text-xs font-semibold uppercase text-muted">
              Navigation session
            </p>

            <p className="mt-1 text-xl font-bold text-ink">
              {summary.navigationSessionMinutes !== null
                ? formatMinutes(
                    summary.navigationSessionMinutes,
                  )
                : "Unavailable"}
            </p>
          </div>
        </div>

        <section className="mt-4 rounded-xl border border-line bg-surface-alt px-4 py-4">
          <h2 className="font-bold text-ink">
            Safety performance
          </h2>

          <p className="mt-2 text-sm text-muted">
            {buildRestSummary(summary)}
          </p>

          <p className="mt-2 text-xs text-muted">
            Navigation session time includes driving, waiting and
            confirmed rest. It is not presented as continuous
            driving time.
          </p>
        </section>
      </section>
    </main>
  );
}