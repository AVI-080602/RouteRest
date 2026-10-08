import type { JourneyPerformanceResponse } from "@/types/journeyPerformance";
import { evaluateJourneyPerformance } from "@/utils/journeyPerformanceAPI";
import { isJourneyPerformanceResponse } from "@/utils/journeyPerformanceValidation";
import {
  DEMO_JOURNEY_RATINGS_STORAGE_KEY,
  loadJourneyRatings,
  saveJourneyRating,
} from "@/utils/journeyRatingStorage";

// These are synthetic inputs, not hardcoded scores. The backend calculates both results.
export const DEMO_JOURNEYS = [
  { journeyId: "d068bd19-e3fa-4633-912f-788008182101", actualMinutes: 15 },
  { journeyId: "d068bd19-e3fa-4633-912f-788008182102", actualMinutes: 7.5 },
] as const;

export function loadDemoRatings(): JourneyPerformanceResponse[] {
  const results = loadJourneyRatings(DEMO_JOURNEY_RATINGS_STORAGE_KEY);
  if (
    results.length > DEMO_JOURNEYS.length ||
    results.some(
      (result, index) =>
        result.journey_id !== DEMO_JOURNEYS[index].journeyId ||
        result.journey.status !== "scored",
    )
  ) {
    throw new Error("Invalid demo history. Reset the demo before continuing.");
  }
  return results;
}

let queue: Promise<unknown> = Promise.resolve();

// Reset and scoring share a separate lock, so a late response cannot undo a reset.
function withDemoLock<T>(operation: () => Promise<T>): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks?.request) {
    return navigator.locks
      .request("routerest-demo-ratings", operation)
      .then((result) => result);
  }
  const work = queue.then(operation);
  queue = work.catch(() => undefined);
  return work;
}

export function scoreDemoJourney(
  step: 1 | 2,
): Promise<JourneyPerformanceResponse> {
  return withDemoLock(async () => {
    if (step !== 1 && step !== 2) throw new Error("Invalid demo step.");
    const results = loadDemoRatings();
    const fixture = DEMO_JOURNEYS[step - 1];
    const existing = results.find(
      (result) => result.journey_id === fixture.journeyId,
    );
    if (existing) return existing;
    if (results.length !== step - 1) {
      throw new Error("Complete the first demo journey before the second.");
    }
    const previous = results[results.length - 1]?.overall;
    const previousTotal = previous?.total_score ?? 0;
    const previousCount = previous?.journey_count ?? 0;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const result = await evaluateJourneyPerformance(
        {
          journey_id: fixture.journeyId,
          status: "completed",
          rests: [
            { required_minutes: 15, actual_minutes: fixture.actualMinutes },
          ],
          checks: [true, true],
          previous_total: previousTotal,
          previous_count: previousCount,
        },
        controller.signal,
      );
      if (
        !isJourneyPerformanceResponse(result) ||
        result.journey_id !== fixture.journeyId ||
        result.journey.status !== "scored"
      ) {
        throw new Error("The server returned an invalid demo rating.");
      }
      return saveJourneyRating(
        result,
        previousTotal,
        previousCount,
        DEMO_JOURNEY_RATINGS_STORAGE_KEY,
      );
    } finally {
      clearTimeout(timer);
    }
  });
}

export function resetDemoRatings(): Promise<void> {
  return withDemoLock(async () => {
    // Never clear navigation, real ratings or any other browser storage.
    window.localStorage.removeItem(DEMO_JOURNEY_RATINGS_STORAGE_KEY);
  });
}
