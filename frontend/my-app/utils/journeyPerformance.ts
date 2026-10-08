import type {
  JourneyPerformanceRecord,
  PerformanceRest,
} from "@/types/journeyPerformance";
import type { NavigationPlan } from "@/types/navigation";
import type { SelfReportedState } from "@/types/stateCheck";
import {
  loadJourneyPerformance,
  saveJourneyPerformance,
} from "@/utils/journeyPerformanceStorage";

// Match the existing four-hour pre-departure validity window.
const PRE_DEPARTURE_MAX_AGE_MS = 4 * 60 * 60 * 1000;

export function createJourneyPerformanceRecord(
  plan: NavigationPlan,
  stateCheck: SelfReportedState | null,
): JourneyPerformanceRecord {
  if (typeof plan.journeyId !== "string" || !plan.journeyId.trim()) {
    throw new Error("A new navigation plan with a journey ID is required.");
  }
  const startedAt = Date.parse(plan.createdAt);
  if (!Number.isFinite(startedAt)) {
    throw new Error("The navigation plan has an invalid start time.");
  }

  const checkedAt = stateCheck ? Date.parse(stateCheck.updatedAt) : NaN;
  const hasValidPreDepartureCheck =
    stateCheck?.context === "pre-departure" &&
    Number.isFinite(checkedAt) &&
    checkedAt <= startedAt &&
    startedAt - checkedAt <= PRE_DEPARTURE_MAX_AGE_MS;

  const waypointIds = new Set<string>();
  const rests: JourneyPerformanceRecord["rests"] = [];
  for (const waypoint of plan.waypoints) {
    // Destinations and fuel-only stops do not create rest obligations.
    if (waypoint.kind !== "stop" || !waypoint.restBreak) continue;
    if (waypointIds.has(waypoint.id)) {
      throw new Error("The navigation plan contains duplicate rest IDs.");
    }
    waypointIds.add(waypoint.id);
    const requiredMinutes =
      (Date.parse(waypoint.restBreak.end) -
        Date.parse(waypoint.restBreak.start)) /
      60000;
    if (!Number.isFinite(requiredMinutes) || requiredMinutes <= 0) {
      throw new Error("A planned rest has an invalid duration.");
    }
    rests.push({
      waypointId: waypoint.id,
      requiredMinutes,
      actualMinutes: null,
      status: "planned",
      afterRestCheck: null,
    });
  }

  return {
    schemaVersion: 1,
    scoringVersion: "v1",
    journeyId: plan.journeyId,
    startedAt: plan.createdAt,
    completedAt: null,
    status: "in_progress",
    isSimulation: false,
    // Snapshot completion only; never score the driver's reported fatigue.
    preDepartureCheck: {
      completed: hasValidPreDepartureCheck ? true : null,
      completedAt: hasValidPreDepartureCheck ? stateCheck!.updatedAt : null,
    },
    rests,
  };
}

export function initializeJourneyPerformance(
  plan: NavigationPlan,
  stateCheck: SelfReportedState | null,
): JourneyPerformanceRecord {
  // Returning an existing record preserves progress and the original snapshot.
  const existing = loadJourneyPerformance(plan.journeyId);
  if (existing) return existing;
  const record = createJourneyPerformanceRecord(plan, stateCheck);
  saveJourneyPerformance(record);
  return record;
}

function loadActiveRest(journeyId: string, waypointId: string) {
  const record = loadJourneyPerformance(journeyId);
  if (!record) {
    throw new Error("Journey performance has not been initialized.");
  }
  if (record.status !== "in_progress") {
    throw new Error("A completed journey cannot be updated.");
  }
  const matches = record.rests.filter((rest) => rest.waypointId === waypointId);
  if (matches.length !== 1) {
    throw new Error(
      "The journey must contain exactly one matching planned rest.",
    );
  }
  return { record, rest: matches[0] };
}

function saveUpdatedRest(
  record: JourneyPerformanceRecord,
  updatedRest: PerformanceRest,
): JourneyPerformanceRecord {
  const updated: JourneyPerformanceRecord = {
    ...record,
    rests: record.rests.map((rest) =>
      rest.waypointId === updatedRest.waypointId ? updatedRest : rest,
    ),
  };
  saveJourneyPerformance(updated);
  return updated;
}

export function startPerformanceRest(
  journeyId: string,
  waypointId: string,
): JourneyPerformanceRecord {
  const { record, rest } = loadActiveRest(journeyId, waypointId);
  if (rest.status === "resting") return record;
  if (rest.status === "skipped") {
    throw new Error("A skipped rest cannot be started through this operation.");
  }
  // A new session keeps previous minutes but needs a fresh after-rest check.
  return saveUpdatedRest(record, {
    ...rest,
    status: "resting",
    afterRestCheck: null,
  });
}

export function finishPerformanceRest(
  journeyId: string,
  waypointId: string,
  actualMinutes: number,
): JourneyPerformanceRecord {
  if (!Number.isFinite(actualMinutes) || actualMinutes < 0) {
    throw new Error("Actual rest minutes must be finite and non-negative.");
  }
  const { record, rest } = loadActiveRest(journeyId, waypointId);
  // Repeating a successful finish must not add time or erase its check.
  if (rest.status === "completed" && rest.actualMinutes === actualMinutes) {
    return record;
  }
  if (rest.status !== "resting") {
    throw new Error("Start the rest before recording its completion.");
  }
  if (actualMinutes < (rest.actualMinutes ?? 0)) {
    throw new Error("Cumulative rest minutes cannot decrease.");
  }
  return saveUpdatedRest(record, {
    ...rest,
    // Completed means the session ended, not that the planned time was met.
    status: "completed",
    actualMinutes,
    afterRestCheck: { completed: null, completedAt: null },
  });
}

export function completePerformanceRestCheck(
  journeyId: string,
  waypointId: string,
  stateCheck: SelfReportedState,
): JourneyPerformanceRecord {
  const { record, rest } = loadActiveRest(journeyId, waypointId);
  if (rest.status !== "completed") {
    throw new Error("Finish the rest before recording its state check.");
  }
  const checkedAt = Date.parse(stateCheck.updatedAt);
  if (
    stateCheck.context !== "after-rest" ||
    !Number.isFinite(checkedAt) ||
    checkedAt < Date.parse(record.startedAt)
  ) {
    throw new Error("A valid after-rest check for this journey is required.");
  }
  const previousCheckedAt = rest.afterRestCheck?.completedAt;
  if (previousCheckedAt && checkedAt < Date.parse(previousCheckedAt)) {
    throw new Error("An older check cannot replace a newer check.");
  }
  if (
    rest.afterRestCheck?.completed === true &&
    previousCheckedAt &&
    checkedAt === Date.parse(previousCheckedAt)
  ) {
    return record;
  }
  return saveUpdatedRest(record, {
    ...rest,
    // Record participation only, regardless of the reported fatigue level.
    afterRestCheck: { completed: true, completedAt: stateCheck.updatedAt },
  });
}
