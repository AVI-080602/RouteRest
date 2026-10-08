import type {
  JourneyPerformanceResponse,
  OverallRating,
} from "@/types/journeyPerformance";
import { isJourneyPerformanceResponse } from "@/utils/journeyPerformanceValidation";

export const JOURNEY_RATINGS_STORAGE_KEY = "journeyRatings:v1";

function lastOverall(
  results: JourneyPerformanceResponse[],
): OverallRating | null {
  for (let index = results.length - 1; index >= 0; index--) {
    const result = results[index];
    if (result.journey.status === "scored") return result.overall;
  }
  return null;
}

function almostEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1e-8;
}

// Check the returned arithmetic against the saved history, not a local scoring rule.
function checkContribution(
  result: JourneyPerformanceResponse,
  previous: OverallRating | null,
): void {
  if (result.journey.status !== "scored" || result.overall === null) return;
  const overall = result.overall;
  const count = (previous?.journey_count ?? 0) + 1;
  const total = (previous?.total_score ?? 0) + result.journey.journey_score;
  const average = total / count;
  if (
    overall.journey_count !== count ||
    !almostEqual(overall.total_score, total) ||
    !almostEqual(overall.overall_average, average) ||
    !almostEqual(
      result.journey.journey_score,
      (result.journey.rest_points ?? 0) + result.journey.check_points,
    ) ||
    (previous
      ? overall.previous_average === null ||
        overall.change === null ||
        !almostEqual(overall.previous_average, previous.overall_average) ||
        !almostEqual(overall.change, average - previous.overall_average)
      : overall.previous_average !== null || overall.change !== null)
  ) {
    throw new Error(
      "The rating does not match the saved history. Please retry.",
    );
  }
}

export function loadJourneyRatings(): JourneyPerformanceResponse[] {
  const raw = window.localStorage.getItem(JOURNEY_RATINGS_STORAGE_KEY);
  if (raw === null) return [];
  const data: unknown = JSON.parse(raw);
  if (
    typeof data !== "object" ||
    data === null ||
    !("schemaVersion" in data) ||
    data.schemaVersion !== 1 ||
    !("results" in data) ||
    !Array.isArray(data.results)
  ) {
    throw new Error(
      "Saved rating history is invalid. It has not been replaced.",
    );
  }
  const results: JourneyPerformanceResponse[] = [];
  const ids = new Set<string>();
  for (const result of data.results) {
    if (!isJourneyPerformanceResponse(result) || ids.has(result.journey_id)) {
      throw new Error(
        "Saved rating history is invalid. It has not been replaced.",
      );
    }
    checkContribution(result, lastOverall(results));
    ids.add(result.journey_id);
    results.push(result);
  }
  return results;
}

export function loadOverallRating(): OverallRating | null {
  return lastOverall(loadJourneyRatings());
}

export function loadJourneyRating(
  journeyId: string,
): JourneyPerformanceResponse | null {
  return (
    loadJourneyRatings().find((result) => result.journey_id === journeyId) ??
    null
  );
}

export function saveJourneyRating(
  result: JourneyPerformanceResponse,
  previousTotal: number,
  previousCount: number,
): JourneyPerformanceResponse {
  if (!isJourneyPerformanceResponse(result))
    throw new Error("Invalid rating response.");
  const results = loadJourneyRatings();
  const existing = results.find(
    (item) => item.journey_id === result.journey_id,
  );
  if (existing) return existing;
  const previous = lastOverall(results);
  if (
    (previous?.total_score ?? 0) !== previousTotal ||
    (previous?.journey_count ?? 0) !== previousCount
  ) {
    throw new Error("Rating history changed while calculating. Please retry.");
  }
  checkContribution(result, previous);
  // One write stores both results and their cumulative history: no second counter to drift.
  window.localStorage.setItem(
    JOURNEY_RATINGS_STORAGE_KEY,
    JSON.stringify({
      schemaVersion: 1,
      results: [...results, result],
    }),
  );
  return result;
}
