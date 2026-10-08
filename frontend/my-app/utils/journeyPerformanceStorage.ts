import type { AfterRestRecord } from "@/types/afterRest";
import type { NavigationPlan, NavigationProgress } from "@/types/navigation";
import type {
  JourneyPerformanceRecord,
  JourneySafetySummary,
} from "@/types/journeyPerformance";
import { isJourneyPerformanceRecord } from "@/utils/journeyPerformanceValidation";

const STORAGE_PREFIX = "journeyPerformance:v1:";

function getStorage(): Storage {
  if (typeof window === "undefined") {
    throw new Error("Journey storage is only available in the browser.");
  }
  return window.localStorage;
}

export function getJourneyPerformanceStorageKey(journeyId: string): string {
  if (!journeyId.trim()) {
    throw new Error("Journey ID is required.");
  }
  return `${STORAGE_PREFIX}${journeyId}`;
}

// Save or replace only the record belonging to this journey.
export function saveJourneyPerformance(record: JourneyPerformanceRecord): void {
  if (!isJourneyPerformanceRecord(record)) {
    throw new Error("Invalid journey performance record.");
  }
  getStorage().setItem(
    getJourneyPerformanceStorageKey(record.journeyId),
    JSON.stringify(record),
  );
}

// Only a missing storage key returns null; corrupt data must remain an error.
export function readJourneyPerformanceData(journeyId: string): unknown | null {
  const raw = getStorage().getItem(getJourneyPerformanceStorageKey(journeyId));
  if (raw === null) {
    return null;
  }

  const parsed: unknown = JSON.parse(raw);
  if (parsed === null) {
    throw new Error("Stored journey performance record cannot be null.");
  }
  return parsed;
}

export function loadJourneyPerformance(
  journeyId: string,
): JourneyPerformanceRecord | null {
  const data = readJourneyPerformanceData(journeyId);
  if (data === null) {
    return null;
  }
  if (!isJourneyPerformanceRecord(data) || data.journeyId !== journeyId) {
    throw new Error("Invalid or mismatched journey performance record.");
  }
  return data;
}
export const JOURNEY_SAFETY_SUMMARY_STORAGE_KEY = "currentJourneySafetySummary";

/**
 * Creates a concise safety summary before navigation data is deleted.
 */
export function createJourneySafetySummary(
  plan: NavigationPlan,
  progress: NavigationProgress,
  restRecords: AfterRestRecord[],
): JourneySafetySummary {
  const completedAtMs = Date.now();
  const completedAt = new Date(completedAtMs).toISOString();

  const navigationStartedAtMs = new Date(plan.createdAt).getTime();

  const navigationSessionMinutes =
    Number.isFinite(navigationStartedAtMs) &&
    completedAtMs >= navigationStartedAtMs
      ? Math.round((completedAtMs - navigationStartedAtMs) / 60000)
      : null;

  const departure =
    plan.waypoints.find((waypoint) => waypoint.kind === "departure") ?? null;

  const destinations = plan.waypoints.filter(
    (waypoint) => waypoint.kind === "destination",
  );

  const plannedStops = plan.waypoints.filter(
    (waypoint) => waypoint.kind === "stop",
  );

  const plannedStopIds = new Set(plannedStops.map((stop) => stop.id));

  /*
   * Only count completed rest records belonging to stops in this
   * journey. Scoped plans exclude preview, legacy and other journey
   * records. Older plans without a journey ID use unscoped history only.
   */
  const completedRestRecords = restRecords.filter(
    (record) =>
      plannedStopIds.has(record.id) &&
      (plan.journeyId
        ? record.journeyId === plan.journeyId
        : record.journeyId === undefined) &&
      record.completed &&
      record.punchInAt !== null &&
      record.punchOutAt !== null &&
      (!Number.isFinite(navigationStartedAtMs) ||
        record.punchInAt >= navigationStartedAtMs),
  );

  const confirmedRestMinutes = completedRestRecords.reduce(
    (total, record) => total + Math.max(0, record.actualRestMins ?? 0),
    0,
  );

  return {
    id: `${plan.createdAt}:${completedAt}`,
    journeyId: plan.journeyId,
    navigationStartedAt: plan.createdAt,
    completedAt,
    departureName: departure?.name ?? "Departure",
    destinationNames: destinations.map((destination) => destination.name),
    plannedDistanceKm: Math.max(0, plan.distanceKm),
    navigationSessionMinutes,
    plannedRestStops: plannedStops.length,
    completedRestStops: completedRestRecords.length,
    confirmedRestMinutes,
    rerouteCount: Math.max(0, progress.rerouteCount),
  };
}

/**
 * Saves the latest completed journey summary on the driver's device.
 */
export function saveJourneySafetySummary(summary: JourneySafetySummary) {
  localStorage.setItem(
    JOURNEY_SAFETY_SUMMARY_STORAGE_KEY,
    JSON.stringify(summary),
  );
}

/**
 * Loads and validates the latest completed journey summary.
 */
export function loadJourneySafetySummary(): JourneySafetySummary | null {
  const storedSummary = localStorage.getItem(
    JOURNEY_SAFETY_SUMMARY_STORAGE_KEY,
  );

  if (!storedSummary) {
    return null;
  }

  try {
    const parsed = JSON.parse(storedSummary) as Partial<JourneySafetySummary>;

    /*
     * Validate destinationNames separately so TypeScript knows
     * that it is definitely a string array after this check.
     */
    const destinationNames = parsed.destinationNames;

    if (
      !Array.isArray(destinationNames) ||
      !destinationNames.every((name) => typeof name === "string")
    ) {
      return null;
    }

    /*
     * Convert the optional value into an explicitly validated
     * number or null. Undefined and invalid numbers are rejected.
     */
    const rawNavigationSessionMinutes = parsed.navigationSessionMinutes;

    let navigationSessionMinutes: number | null;

    if (rawNavigationSessionMinutes === null) {
      navigationSessionMinutes = null;
    } else if (
      typeof rawNavigationSessionMinutes === "number" &&
      Number.isFinite(rawNavigationSessionMinutes)
    ) {
      navigationSessionMinutes = rawNavigationSessionMinutes;
    } else {
      return null;
    }

    if (
      typeof parsed.id !== "string" ||
      (parsed.journeyId !== undefined &&
        (typeof parsed.journeyId !== "string" || !parsed.journeyId.trim())) ||
      typeof parsed.navigationStartedAt !== "string" ||
      !Number.isFinite(Date.parse(parsed.navigationStartedAt)) ||
      typeof parsed.completedAt !== "string" ||
      !Number.isFinite(Date.parse(parsed.completedAt)) ||
      typeof parsed.departureName !== "string" ||
      typeof parsed.plannedDistanceKm !== "number" ||
      !Number.isFinite(parsed.plannedDistanceKm) ||
      typeof parsed.plannedRestStops !== "number" ||
      !Number.isFinite(parsed.plannedRestStops) ||
      typeof parsed.completedRestStops !== "number" ||
      !Number.isFinite(parsed.completedRestStops) ||
      typeof parsed.confirmedRestMinutes !== "number" ||
      !Number.isFinite(parsed.confirmedRestMinutes) ||
      typeof parsed.rerouteCount !== "number" ||
      !Number.isFinite(parsed.rerouteCount)
    ) {
      return null;
    }

    return {
      id: parsed.id,
      journeyId: parsed.journeyId,
      navigationStartedAt: parsed.navigationStartedAt,
      completedAt: parsed.completedAt,
      departureName: parsed.departureName,
      destinationNames,
      plannedDistanceKm: parsed.plannedDistanceKm,
      navigationSessionMinutes,
      plannedRestStops: parsed.plannedRestStops,
      completedRestStops: parsed.completedRestStops,
      confirmedRestMinutes: parsed.confirmedRestMinutes,
      rerouteCount: parsed.rerouteCount,
    };
  } catch {
    return null;
  }
}
