"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowRight, CheckCircle2, House, RefreshCw } from "lucide-react";
import { Link } from "@/utils/appNavigation";
import type {
  JourneyPerformanceRecord,
  JourneyPerformanceResponse,
  JourneySafetySummary,
  OverallRating,
} from "@/types/journeyPerformance";
import {
  loadJourneyPerformance,
  loadJourneySafetySummary,
} from "@/utils/journeyPerformanceStorage";
import { scoreCompletedJourney } from "@/utils/journeyRating";
import {
  JOURNEY_RATINGS_STORAGE_KEY,
  loadJourneyRating,
  loadOverallRating,
} from "@/utils/journeyRatingStorage";

type RatingView = {
  summary: JourneySafetySummary | null;
  record: JourneyPerformanceRecord | null;
  result: JourneyPerformanceResponse | null;
  overall: OverallRating | null;
  loading: boolean;
  error: string;
};

const EMPTY_VIEW: RatingView = {
  summary: null,
  record: null,
  result: null,
  overall: null,
  loading: true,
  error: "",
};
const NUMBER = new Intl.NumberFormat("en-AU", { maximumFractionDigits: 1 });
const DATE_TIME = new Intl.DateTimeFormat("en-AU", {
  dateStyle: "medium",
  timeStyle: "short",
});

function RatingContent() {
  const searchParams = useSearchParams();
  const requestedId = searchParams.get("journeyId");
  const [view, setView] = useState<RatingView>(EMPTY_VIEW);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      let initial = { ...EMPTY_VIEW };
      try {
        const summary = loadJourneySafetySummary();
        const journeyId = requestedId ?? summary?.journeyId;
        const record = journeyId ? loadJourneyPerformance(journeyId) : null;
        const result = journeyId ? loadJourneyRating(journeyId) : null;
        initial = {
          summary:
            !requestedId || summary?.journeyId === requestedId ? summary : null,
          record,
          result,
          overall: loadOverallRating(),
          loading: false,
          error: "",
        };
        if (cancelled) return;
        if (!record || record.isSimulation || record.status !== "completed") {
          setView(initial);
          return;
        }
        setView({ ...initial, loading: result === null });
        const saved = await scoreCompletedJourney(record.journeyId);
        if (!cancelled)
          setView({
            ...initial,
            result: saved,
            overall: loadOverallRating(),
            loading: false,
          });
      } catch {
        if (!cancelled)
          setView({
            ...initial,
            loading: false,
            error:
              "Your rating could not be loaded or saved. Check your connection and try again. Your completed journey has been kept.",
          });
      }
    }
    queueMicrotask(() => {
      if (!cancelled) void load();
    });
    return () => {
      cancelled = true;
    };
  }, [requestedId, attempt]);

  // A different tab can finish another journey while this result stays open.
  useEffect(() => {
    function refreshOverall(event: StorageEvent) {
      if (event.key !== JOURNEY_RATINGS_STORAGE_KEY && event.key !== null)
        return;
      try {
        const overall = loadOverallRating();
        setView((current) => ({ ...current, overall }));
      } catch {
        setView((current) => ({
          ...current,
          error:
            "Saved rating history could not be read. Your completed journey has been kept.",
        }));
      }
    }
    window.addEventListener("storage", refreshOverall);
    return () => window.removeEventListener("storage", refreshOverall);
  }, []);

  const { summary, record, result, overall, loading, error } = view;
  const scored = result?.journey.status === "scored" ? result.journey : null;
  const contribution = result?.overall?.change;

  return (
    <main className="container mx-auto max-w-2xl px-4 py-6">
      <header className="border-b border-line pb-5">
        <p className="flex items-center gap-2 text-sm font-semibold text-brand">
          <CheckCircle2 className="h-5 w-5" aria-hidden />
          {record?.status === "completed" || summary
            ? "Journey completed"
            : "Journey performance"}
        </p>
        <h1 className="mt-2 text-2xl font-bold text-ink">Journey Rating</h1>
        {summary && (
          <p className="mt-2 break-words text-base text-ink">
            {summary.departureName} to{" "}
            {summary.destinationNames.join(", ") || "Destination"}
          </p>
        )}
        {(record?.completedAt || summary?.completedAt) && (
          <p className="mt-1 text-sm text-muted">
            {DATE_TIME.format(
              new Date(record?.completedAt ?? summary!.completedAt),
            )}
          </p>
        )}
      </header>

      {loading && (
        <p role="status" className="py-6 text-sm text-muted">
          Calculating your rating...
        </p>
      )}
      {error && (
        <div role="alert" className="border-b border-line py-5">
          <p className="text-sm text-danger">{error}</p>
          <button
            type="button"
            onClick={() => setAttempt((value) => value + 1)}
            className="mt-3 inline-flex items-center gap-2 rounded-lg border border-line-strong px-4 py-2 text-sm font-semibold text-ink"
          >
            <RefreshCw className="h-4 w-4" aria-hidden />
            Retry rating
          </button>
        </div>
      )}
      {!loading && !error && record?.isSimulation && (
        <p role="status" className="py-5 text-sm text-muted">
          Simulated journey. This trip is not included in your overall rating.
        </p>
      )}
      {!loading && !error && !record && (
        <p className="py-5 text-sm text-muted">
          No completed scoring record is available for this journey.
        </p>
      )}
      {!loading && !error && record && record.status !== "completed" && (
        <p className="py-5 text-sm text-muted">
          Finish this journey before requesting a rating.
        </p>
      )}
      {result?.journey.status === "insufficient_data" && (
        <p role="status" className="py-5 text-sm text-muted">
          Some rest or check records are missing. This journey has not changed
          your overall rating.
        </p>
      )}

      {(scored || overall) && (
        <section
          aria-label="Journey ratings"
          className="grid grid-cols-2 gap-4 border-b border-line py-6"
        >
          <div>
            <h2 className="text-sm font-semibold text-muted">This journey</h2>
            <p className="mt-2 text-4xl font-bold text-ink">
              {scored ? NUMBER.format(scored.journey_score) : "--"}
              <span className="ml-1 text-base font-normal text-muted">
                /100
              </span>
            </p>
          </div>
          <div>
            <h2 className="text-sm font-semibold text-muted">Overall rating</h2>
            <p className="mt-2 text-4xl font-bold text-brand">
              {overall ? NUMBER.format(overall.overall_average) : "--"}
              <span className="ml-1 text-base font-normal text-muted">
                /100
              </span>
            </p>
            {overall && (
              <p className="mt-2 text-xs text-muted">
                {overall.journey_count} rated{" "}
                {overall.journey_count === 1 ? "journey" : "journeys"}
              </p>
            )}
          </div>
          {scored && (
            <p className="col-span-2 text-sm text-muted">
              {contribution === null || contribution === undefined
                ? "Your first rated journey sets your initial overall rating."
                : `Overall average change when this journey was recorded: ${contribution > 0 ? "+" : ""}${NUMBER.format(contribution)} points.`}
            </p>
          )}
        </section>
      )}

      {scored && (
        <section
          aria-label="Score breakdown"
          className="border-b border-line py-5"
        >
          <h2 className="text-base font-semibold text-ink">Score breakdown</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Rest adherence</dt>
              <dd className="font-semibold text-ink">
                {scored.rest_points === null
                  ? "Not applicable"
                  : `${NUMBER.format(scored.rest_points)} / 80`}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Checks completed</dt>
              <dd className="font-semibold text-ink">
                {NUMBER.format(scored.check_points)} /{" "}
                {scored.rest_applicable ? 20 : 100}
              </dd>
            </div>
          </dl>
        </section>
      )}

      {summary && (
        <dl className="grid grid-cols-2 gap-4 border-b border-line py-5 text-sm">
          <div>
            <dt className="text-muted">Planned distance</dt>
            <dd className="mt-1 font-semibold text-ink">
              {NUMBER.format(summary.plannedDistanceKm)} km
            </dd>
          </div>
          <div>
            <dt className="text-muted">Recorded planned rest</dt>
            <dd className="mt-1 font-semibold text-ink">
              {NUMBER.format(
                record
                  ? record.rests.reduce(
                      (total, rest) => total + (rest.actualMinutes ?? 0),
                      0,
                    )
                  : summary.confirmedRestMinutes,
              )}{" "}
              min
            </dd>
          </div>
        </dl>
      )}
      <p className="mt-5 text-xs leading-relaxed text-muted">
        Ratings reflect recorded rest and check completion, not whether you are
        fit to drive. Your rating history is saved on this device.
      </p>
      <nav aria-label="Next journey" className="mt-6 flex flex-wrap gap-3">
        <Link
          href="/newjourney"
          className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-3 text-sm font-semibold text-white"
        >
          Plan another journey
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
        <Link
          href="/"
          className="inline-flex items-center gap-2 rounded-lg border border-line-strong px-4 py-3 text-sm font-semibold text-ink"
        >
          <House className="h-4 w-4" aria-hidden />
          Home
        </Link>
      </nav>
    </main>
  );
}

export default function PerformancePage() {
  return (
    <Suspense
      fallback={
        <main className="container mx-auto max-w-2xl px-4 py-6">
          <p role="status">Loading journey...</p>
        </main>
      }
    >
      <RatingContent />
    </Suspense>
  );
}
