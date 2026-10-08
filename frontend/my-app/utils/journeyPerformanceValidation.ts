import type {
  JourneyPerformanceRecord,
  PerformanceCheck,
  PerformanceRest,
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
