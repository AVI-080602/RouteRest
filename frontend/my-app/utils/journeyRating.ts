import type { JourneyPerformanceResponse } from "@/types/journeyPerformance";
import { evaluateJourneyPerformance } from "@/utils/journeyPerformanceAPI";
import { loadJourneyPerformance } from "@/utils/journeyPerformanceStorage";
import { isJourneyPerformanceResponse } from "@/utils/journeyPerformanceValidation";
import { buildJourneyPerformanceRequest } from "@/utils/journeyRequest";
import {
  loadJourneyRating,
  loadOverallRating,
  saveJourneyRating,
} from "@/utils/journeyRatingStorage";

const pending = new Map<string, Promise<JourneyPerformanceResponse>>();
let queue: Promise<unknown> = Promise.resolve();

async function calculateAndSave(
  journeyId: string,
): Promise<JourneyPerformanceResponse> {
  const record = loadJourneyPerformance(journeyId);
  if (!record || record.status !== "completed" || record.isSimulation) {
    throw new Error("A completed, non-simulated journey is required.");
  }
  const existing = loadJourneyRating(journeyId);
  if (existing) return existing;
  const overall = loadOverallRating();
  const request = buildJourneyPerformanceRequest(
    record,
    overall?.total_score ?? 0,
    overall?.journey_count ?? 0,
  );
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const result = await evaluateJourneyPerformance(request, controller.signal);
    if (
      !isJourneyPerformanceResponse(result) ||
      result.journey_id !== journeyId
    ) {
      throw new Error("The server returned an invalid or mismatched rating.");
    }
    return saveJourneyRating(
      result,
      request.previous_total,
      request.previous_count,
    );
  } finally {
    clearTimeout(timer);
  }
}

export function scoreCompletedJourney(
  journeyId: string,
): Promise<JourneyPerformanceResponse> {
  const existing = pending.get(journeyId);
  if (existing) return existing;
  const operation = () => calculateAndSave(journeyId);
  // Web Locks serialize updates across tabs. The queue covers browsers without it.
  let work: Promise<JourneyPerformanceResponse>;
  if (typeof navigator !== "undefined" && navigator.locks?.request) {
    work = navigator.locks
      .request("routerest-journey-ratings", operation)
      .then((result) => result);
  } else {
    work = queue.then(operation);
    queue = work.catch(() => undefined);
  }
  const promise = work.finally(() => pending.delete(journeyId));
  pending.set(journeyId, promise);
  return promise;
}
