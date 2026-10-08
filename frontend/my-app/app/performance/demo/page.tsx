"use client";

import { useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  FlaskConical,
  House,
  Play,
  RotateCcw,
} from "lucide-react";
import JourneyRatingSummary from "@/components/JourneyRatingSummary";
import type { JourneyPerformanceResponse } from "@/types/journeyPerformance";
import { Link } from "@/utils/appNavigation";
import {
  loadDemoRatings,
  resetDemoRatings,
  scoreDemoJourney,
} from "@/utils/journeyRatingDemo";
import { DEMO_JOURNEY_RATINGS_STORAGE_KEY } from "@/utils/journeyRatingStorage";

type Action = 1 | 2 | "reset";

export default function RatingDemoPage() {
  const [results, setResults] = useState<JourneyPerformanceResponse[]>([]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    function refresh() {
      if (!mounted.current) return;
      try {
        setResults(loadDemoRatings());
        setError("");
      } catch {
        setError(
          "Demo history could not be read. Reset the demo to start again.",
        );
      }
      setReady(true);
    }
    function onStorage(event: StorageEvent) {
      if (event.key === DEMO_JOURNEY_RATINGS_STORAGE_KEY || event.key === null)
        refresh();
    }
    queueMicrotask(refresh);
    window.addEventListener("storage", onStorage);
    return () => {
      mounted.current = false;
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  async function run(action: Action) {
    if (inFlight.current || !ready) return;
    inFlight.current = true;
    setBusy(action);
    setError("");
    try {
      if (action === "reset") await resetDemoRatings();
      else await scoreDemoJourney(action);
      if (mounted.current) setResults(loadDemoRatings());
    } catch {
      if (mounted.current)
        setError(
          action === "reset"
            ? "The demo could not be reset. Try again."
            : "The demo rating could not be calculated or saved. Check the backend connection and try the journey again.",
        );
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(null);
    }
  }

  const latest = results[results.length - 1] ?? null;
  const disabled = !ready || busy !== null;

  return (
    <main className="container mx-auto max-w-2xl px-4 py-6">
      <header className="border-b border-line pb-5">
        <div className="flex items-center justify-between gap-3">
          <p className="flex items-center gap-2 text-sm font-semibold text-brand">
            <FlaskConical className="h-5 w-5" aria-hidden />
            Journey performance
          </p>
          <span className="border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-bold text-amber-900">
            Demo
          </span>
        </div>
        <h1 className="mt-2 text-2xl font-bold text-ink">Journey Rating</h1>
        <p className="mt-2 text-sm text-muted">
          Demo journeys are not included in your real rating.
        </p>
      </header>

      <section aria-label="Demo journeys" className="border-b border-line py-5">
        <ol className="divide-y divide-line">
          {([1, 2] as const).map((step) => {
            const complete = results.length >= step;
            return (
              <li
                key={step}
                className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0"
              >
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold text-ink">
                    Journey {step}
                  </h2>
                  <p className="mt-1 text-sm text-muted">
                    {step === 1
                      ? "15 of 15 min rested"
                      : "7.5 of 15 min rested"}{" "}
                    &middot; 2 of 2 checks
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void run(step)}
                  disabled={disabled || complete || results.length !== step - 1}
                  className="inline-flex h-11 w-full shrink-0 items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 sm:w-52"
                >
                  {complete ? (
                    <CheckCircle2 className="h-4 w-4" aria-hidden />
                  ) : (
                    <Play className="h-4 w-4" aria-hidden />
                  )}
                  {complete
                    ? `Journey ${step} completed`
                    : `Complete journey ${step}`}
                </button>
              </li>
            );
          })}
        </ol>
        <button
          type="button"
          onClick={() => void run("reset")}
          disabled={disabled}
          className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-lg border border-line-strong px-4 py-2 text-sm font-semibold text-ink disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RotateCcw className="h-4 w-4" aria-hidden />
          Reset demo
        </button>
      </section>

      <div
        aria-live="polite"
        aria-atomic="true"
        className="min-h-12 py-3 text-sm"
      >
        {error ? (
          <p role="alert" className="text-danger">
            {error}
          </p>
        ) : !ready ? (
          <p className="text-muted">Loading demo...</p>
        ) : busy ? (
          <p className="text-muted">
            {busy === "reset"
              ? "Resetting demo..."
              : `Calculating journey ${busy}...`}
          </p>
        ) : latest ? (
          <p className="text-brand">Journey {results.length} rating saved.</p>
        ) : (
          <p className="text-muted">No demo journeys completed.</p>
        )}
      </div>
      <JourneyRatingSummary
        result={latest}
        overall={latest?.overall ?? null}
        showEmpty
      />
      <p className="mt-5 text-xs leading-relaxed text-muted">
        Ratings reflect recorded rest and check completion, not whether you are
        fit to drive.
      </p>
      <nav aria-label="Leave demo" className="mt-6 flex flex-wrap gap-3">
        <Link
          href="/"
          className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-line-strong px-4 py-2 text-sm font-semibold text-ink"
        >
          <House className="h-4 w-4" aria-hidden />
          Home
        </Link>
        <Link
          href="/performance"
          className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-line-strong px-4 py-2 text-sm font-semibold text-ink"
        >
          <CheckCircle2 className="h-4 w-4" aria-hidden />
          My journey rating
        </Link>
      </nav>
    </main>
  );
}
