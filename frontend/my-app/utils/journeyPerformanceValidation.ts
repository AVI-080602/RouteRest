import type {
  JourneyPerformanceRecord,
  PerformanceCheck,
  PerformanceRest,
  JourneyPerformanceResponse,
} from "@/types/journeyPerformance";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isCheck(value: unknown): value is PerformanceCheck {
  return (
    isObject(value) &&
    (value.completed === null || typeof value.completed === "boolean") &&
    (value.completedAt === null || isDate(value.completedAt))
  );
}

function isRest(value: unknown): value is PerformanceRest {
  return (
    isObject(value) &&
    typeof value.waypointId === "string" &&
    value.waypointId.trim().length > 0 &&
    isNumber(value.requiredMinutes) &&
    value.requiredMinutes > 0 &&
    (value.actualMinutes === null ||
      (isNumber(value.actualMinutes) && value.actualMinutes >= 0)) &&
    typeof value.status === "string" &&
    ["planned", "resting", "completed", "skipped"].includes(value.status) &&
    (value.afterRestCheck === null || isCheck(value.afterRestCheck))
  );
}

// Validate stored JSON before treating it as a typed journey record.
export function isJourneyPerformanceRecord(
  value: unknown,
): value is JourneyPerformanceRecord {
  return (
    isObject(value) &&
    value.schemaVersion === 1 &&
    value.scoringVersion === "v1" &&
    typeof value.journeyId === "string" &&
    value.journeyId.trim().length > 0 &&
    isDate(value.startedAt) &&
    (value.completedAt === null || isDate(value.completedAt)) &&
    (value.status === "in_progress" || value.status === "completed") &&
    typeof value.isSimulation === "boolean" &&
    isCheck(value.preDepartureCheck) &&
    Array.isArray(value.rests) &&
    value.rests.every(isRest)
  );
}

function isInRange(
  value: unknown,
  min: number,
  max: number,
): value is number {
  return isNumber(value) && value >= min && value <= max;
}

export function isJourneyPerformanceResponse(
  value: unknown,
): value is JourneyPerformanceResponse {
  if (
    !isObject(value) ||
    typeof value.journey_id !== "string" ||
    !value.journey_id.trim() ||
    !isObject(value.journey)
  ) {
    return false;
  }

  const journey = value.journey;
  if (journey.scoring_version !== "v1") return false;

  // Missing data must never include an updated overall rating.
  if (journey.status === "insufficient_data") {
    return value.overall === null;
  }

  if (
    journey.status !== "scored" ||
    !isInRange(journey.journey_score, 0, 100) ||
    typeof journey.rest_applicable !== "boolean"
  ) {
    return false;
  }

  if (journey.rest_applicable) {
    if (!isInRange(journey.rest_points, 0, 80)) return false;
    if (!isInRange(journey.check_points, 0, 20)) return false;
  } else {
    if (journey.rest_points !== null) return false;
    if (!isInRange(journey.check_points, 0, 100)) return false;
  }

  const overall = value.overall;
  if (
    !isObject(overall) ||
    !isNumber(overall.journey_count) ||
    !Number.isSafeInteger(overall.journey_count) ||
    overall.journey_count < 1
  ) {
    return false;
  }

  return (
    isInRange(overall.total_score, 0, 100 * overall.journey_count) &&
    isInRange(overall.overall_average, 0, 100) &&
    (overall.journey_count === 1
      ? overall.previous_average === null && overall.change === null
      : isInRange(overall.previous_average, 0, 100) &&
        isInRange(overall.change, -100, 100))
  );
}
