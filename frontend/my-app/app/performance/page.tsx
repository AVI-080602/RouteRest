"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  ArrowRight,
  CheckCircle2,
  FlaskConical,
  House,
  RefreshCw,
} from "lucide-react";
import JourneyRatingSummary from "@/components/JourneyRatingSummary";
import JourneyFeedbackCard from "@/components/JourneyFeedbackCard";
import { getJourneyFeedback } from "@/utils/journeyFeedback";
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
import PageTopBar from "@/components/PageTopBar";

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
        initial = {
          summary:
            journeyId && summary?.journeyId === journeyId ? summary : null,
          record,
          result: null,
          overall: null,
          loading: false,
          error: "",
        };
        // Keep rest feedback available even if rating history or the API fails.
        if (cancelled) return;
        setView(initial);
        const result = journeyId ? loadJourneyRating(journeyId) : null;
        initial = {
          ...initial,
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
  const feedback = getJourneyFeedback(
    requestedId ?? summary?.journeyId ?? null,
    record,
  );
  const completedRests = record?.rests.filter(
    (rest) => rest.status === "completed" && rest.actualMinutes !== null,
  );

  return (
    <main className="min-h-svh bg-surface-alt px-4 py-6 sm:py-8">
      <div className="mx-auto max-w-3xl">
        <PageTopBar fallback="/" className="mb-4" />
        <header className="rounded-3xl border border-line bg-surface p-5 sm:p-7">
          <p className="flex items-center gap-2 text-sm font-semibold text-brand">
            <CheckCircle2 className="h-5 w-5" aria-hidden />
            {record?.status === "completed" || summary
              ? "Journey completed"
              : "Journey performance"}
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-ink">
            Journey performance
          </h1>
          <p className="mt-2 text-sm text-muted">
            Your journey feedback and rating, based on recorded rests.
          </p>
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
          {(summary || record) && (
            <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-line pt-4 text-sm">
              <div>
                <dt className="text-muted">Planned distance</dt>
                <dd className="mt-1 font-bold text-ink">
                  {summary
                    ? `${NUMBER.format(summary.plannedDistanceKm)} km`
                    : "Not available"}
                </dd>
              </div>
              <div>
                <dt className="text-muted">Recorded rest breaks</dt>
                <dd className="mt-1 font-bold text-ink">
                  {record
                    ? `${completedRests!.length} of ${record.rests.length} planned`
                    : "Not available"}
                </dd>
              </div>
            </dl>
          )}
        </header>

        {(record || !loading) && (
          <div className="mt-5">
            <JourneyFeedbackCard feedback={feedback} showExamples />
          </div>
        )}

        <section
          aria-labelledby="journey-rating-title"
          className="mt-5 rounded-3xl border border-line bg-surface p-5 sm:p-6"
        >
          <h2 id="journey-rating-title" className="text-lg font-bold text-ink">
            Journey rating
          </h2>
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
              Simulated journey. This trip is not included in your overall
              rating.
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
              Some rest or check records are missing. This journey has not
              changed your overall rating.
            </p>
          )}

          <JourneyRatingSummary result={result} overall={overall} showEmpty />
          <p className="mt-5 text-xs leading-relaxed text-muted">
            Ratings reflect recorded rest and check completion, not whether you
            are fit to drive. Your rating history is saved on this device.
          </p>
        </section>
        <nav aria-label="Next journey" className="mt-6 flex flex-wrap gap-3">
          <Link
            href="/newjourney"
            className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-action px-4 py-3 text-sm font-semibold text-on-action hover:bg-action-strong sm:flex-none"
          >
            Plan another journey
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
          <Link
            href="/"
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-line-strong bg-surface px-4 py-3 text-sm font-semibold text-ink"
          >
            <House className="h-4 w-4" aria-hidden />
            Home
          </Link>
        </nav>
        <Link
          href="/performance/demo"
          className="mt-5 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-brand"
        >
          <FlaskConical className="h-4 w-4" aria-hidden />
          Rating demo
        </Link>
      </div>
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
