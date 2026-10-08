import type { AfterRestRecord, AfterRestStopDetails } from "@/types/afterRest";
import type { NavigationPlan } from "@/types/navigation";
import { NAVIGATION_PLAN_STORAGE_KEY } from "@/types/navigation";
import type {
  SelfReportedState,
  SelfReportedStateValue,
} from "@/types/stateCheck";
import {
  AFTER_REST_RECORDS_STORAGE_KEY,
  getAfterRestRecordById,
  saveAfterRestRecord,
} from "@/utils/afterRestStorage";
import {
  completePerformanceRestCheck,
  finishPerformanceRest,
  startPerformanceRest,
} from "@/utils/journeyPerformance";
import {
  getJourneyPerformanceStorageKey,
  loadJourneyPerformance,
} from "@/utils/journeyPerformanceStorage";
import {
  createSelfReportedState,
  saveStateCheckResult,
  STATE_CHECK_STORAGE_KEY,
} from "@/utils/stateCheckStorage";

function loadSessionScope(journeyId: string | null, stopId: string) {
  if (journeyId === null) return { trackPerformance: false };
  const raw = localStorage.getItem(NAVIGATION_PLAN_STORAGE_KEY);
  const plan = raw ? (JSON.parse(raw) as NavigationPlan) : null;
  const waypoint = plan?.waypoints?.find(
    (item) => item.kind === "stop" && item.id === stopId,
  );
  if (!plan || plan.journeyId !== journeyId || !waypoint) {
    throw new Error("This rest no longer belongs to the current navigation.");
  }
  const performance = loadJourneyPerformance(journeyId);
  if (!performance || performance.status !== "in_progress") {
    throw new Error("An active journey performance record is required.");
  }
  const trackPerformance = performance.rests.some(
    (rest) => rest.waypointId === stopId,
  );
  if (waypoint.restBreak && !trackPerformance) {
    throw new Error(
      "The planned rest is missing from this journey's performance record.",
    );
  }
  return { trackPerformance };
}

// localStorage has no multi-key transaction. Restore changed keys on failure
// when possible, and propagate the error so the page never reports success.
function saveSessionUpdate(journeyId: string | null, operation: () => void) {
  const keys = [AFTER_REST_RECORDS_STORAGE_KEY, STATE_CHECK_STORAGE_KEY];
  if (journeyId !== null) keys.push(getJourneyPerformanceStorageKey(journeyId));
  const before = keys.map((key) => ({ key, value: localStorage.getItem(key) }));
  try {
    operation();
  } catch (error) {
    try {
      for (const { key, value } of before) {
        if (localStorage.getItem(key) === value) continue;
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      }
    } catch {
      throw new Error(
        "Rest records could not be restored. Reload before retrying.",
      );
    }
    throw error;
  }
}

export function punchInAfterRest(
  journeyId: string | null,
  stop: AfterRestStopDetails,
  now = Date.now(),
): AfterRestRecord {
  if (!Number.isFinite(now) || now < 0)
    throw new Error("Invalid rest start time.");
  const scope = loadSessionScope(journeyId, stop.id);
  const previous = getAfterRestRecordById(stop.id, journeyId);
  if (
    previous?.punchInAt !== null &&
    previous?.punchInAt !== undefined &&
    previous.punchOutAt === null
  ) {
    return previous;
  }
  const record: AfterRestRecord = {
    journeyId,
    id: stop.id,
    stopName: stop.stopName,
    requiredRestMins: stop.requiredRestMins,
    punchInAt: now,
    punchOutAt: null,
    actualRestMins: previous?.actualRestMins ?? null,
    completed: false,
    stateCheck: null,
    locationLabel: stop.locationLabel,
    coordinate: stop.coordinate,
  };
  saveSessionUpdate(journeyId, () => {
    if (scope.trackPerformance) startPerformanceRest(journeyId!, stop.id);
    saveAfterRestRecord(record);
  });
  return record;
}

export function punchOutAfterRest(
  journeyId: string | null,
  stopId: string,
  now = Date.now(),
): AfterRestRecord {
  const scope = loadSessionScope(journeyId, stopId);
  const previous = getAfterRestRecordById(stopId, journeyId);
  if (!previous || previous.punchInAt === null)
    throw new Error("Start the rest first.");
  if (previous.punchOutAt !== null) return previous;
  if (!Number.isFinite(now) || now < previous.punchInAt)
    throw new Error("Invalid rest end time.");
  // Keep exact elapsed minutes for scoring; round only the displayed text.
  const actualRestMins =
    (previous.actualRestMins ?? 0) + (now - previous.punchInAt) / 60000;
  const record: AfterRestRecord = {
    ...previous,
    punchOutAt: now,
    actualRestMins,
    completed:
      previous.requiredRestMins !== null &&
      actualRestMins >= previous.requiredRestMins,
    stateCheck: null,
  };
  saveSessionUpdate(journeyId, () => {
    if (scope.trackPerformance)
      finishPerformanceRest(journeyId!, stopId, actualRestMins);
    saveAfterRestRecord(record);
  });
  return record;
}

export function completeAfterRestSessionCheck(
  journeyId: string | null,
  stopId: string,
  value: SelfReportedStateValue,
  now = Date.now(),
): AfterRestRecord {
  const scope = loadSessionScope(journeyId, stopId);
  const previous = getAfterRestRecordById(stopId, journeyId);
  if (
    !previous ||
    previous.punchOutAt === null ||
    !Number.isFinite(now) ||
    now < previous.punchOutAt
  ) {
    throw new Error("Finish the current rest before checking your state.");
  }
  const stateCheck: SelfReportedState = {
    ...createSelfReportedState(value, "after-rest"),
    updatedAt: new Date(now).toISOString(),
  };
  const record: AfterRestRecord = { ...previous, stateCheck };
  saveSessionUpdate(journeyId, () => {
    if (scope.trackPerformance)
      completePerformanceRestCheck(journeyId!, stopId, stateCheck);
    saveAfterRestRecord(record);
    saveStateCheckResult(stateCheck);
  });
  return record;
}
