import type { AfterRestRecord, AfterRestStopDetails } from "../types/afterRest";
import { SELF_REPORTED_STATE_OPTIONS } from "@/types/stateCheck";

export const AFTER_REST_RECORDS_STORAGE_KEY = "afterRestRecords";
const SELECTED_AFTER_REST_STOP_KEY = "selectedAfterRestStop";

export function saveSelectedAfterRestStop(stop: AfterRestStopDetails) {
  localStorage.setItem(SELECTED_AFTER_REST_STOP_KEY, JSON.stringify(stop));
}

export function loadSelectedAfterRestStop(
  stopId: string | null,
): AfterRestStopDetails | null {
  const stopJson = localStorage.getItem(SELECTED_AFTER_REST_STOP_KEY);

  if (!stopJson) {
    return null;
  }

  try {
    const stop = JSON.parse(stopJson) as Partial<AfterRestStopDetails>;

    if (
      typeof stop.id !== "string" ||
      typeof stop.stopName !== "string" ||
      (stop.requiredRestMins !== null &&
        typeof stop.requiredRestMins !== "number")
    ) {
      return null;
    }

    if (stopId && stop.id !== stopId) {
      return null;
    }

    return {
      id: stop.id,
      stopName: stop.stopName,
      requiredRestMins: stop.requiredRestMins ?? null,
      locationLabel: stop.locationLabel,
      coordinate: stop.coordinate,
    };
  } catch {
    return null;
  }
}

function isNullableNumber(value: unknown): boolean {
  return (
    value === null ||
    (typeof value === "number" && Number.isFinite(value) && value >= 0)
  );
}

function isAfterRestRecord(value: unknown): value is AfterRestRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const record = value as Record<string, unknown>;
  if (
    typeof record.id !== "string" ||
    !record.id.trim() ||
    typeof record.stopName !== "string" ||
    !(
      record.journeyId === undefined ||
      record.journeyId === null ||
      (typeof record.journeyId === "string" &&
        record.journeyId.trim().length > 0)
    ) ||
    !isNullableNumber(record.requiredRestMins) ||
    !isNullableNumber(record.punchInAt) ||
    !isNullableNumber(record.punchOutAt) ||
    !isNullableNumber(record.actualRestMins) ||
    typeof record.completed !== "boolean"
  )
    return false;
  if (record.stateCheck !== undefined && record.stateCheck !== null) {
    if (
      typeof record.stateCheck !== "object" ||
      Array.isArray(record.stateCheck)
    )
      return false;
    const check = record.stateCheck as Record<string, unknown>;
    if (
      check.context !== "after-rest" ||
      check.source !== "Self-report" ||
      !SELF_REPORTED_STATE_OPTIONS.some(
        (option) => option.value === check.value,
      ) ||
      typeof check.label !== "string" ||
      typeof check.updatedAt !== "string" ||
      !Number.isFinite(Date.parse(check.updatedAt)) ||
      typeof record.punchOutAt !== "number" ||
      Date.parse(check.updatedAt) < record.punchOutAt
    )
      return false;
  }
  return true;
}

// Preserve legacy entries, but fail explicitly on corrupt history.
export function loadAfterRestRecords(): AfterRestRecord[] {
  const recordsJson = localStorage.getItem(AFTER_REST_RECORDS_STORAGE_KEY);
  if (recordsJson === null) {
    return [];
  }
  const records: unknown = JSON.parse(recordsJson);
  if (!Array.isArray(records) || !records.every(isAfterRestRecord)) {
    throw new Error(
      "Invalid after-rest history. Existing data has not been replaced.",
    );
  }
  return records;
}

/**
 * Update only the matching journey and waypoint, keeping other journeys intact.
 * @param record The AfterRestRecord object to be saved.
 */
export function saveAfterRestRecord(record: AfterRestRecord) {
  if (record.journeyId === undefined || !isAfterRestRecord(record)) {
    throw new Error("A valid scoped after-rest record is required.");
  }
  const records = loadAfterRestRecords();
  const existingIndex = records.findIndex(
    (r) => r.id === record.id && r.journeyId === record.journeyId,
  );
  if (existingIndex !== -1) {
    records[existingIndex] = record;
  } else {
    records.push(record);
  }
  localStorage.setItem(AFTER_REST_RECORDS_STORAGE_KEY, JSON.stringify(records));
}

/**
 * Retrieves an AfterRestRecord object from localStorage by its ID.
 * @param id The ID of the AfterRestRecord to retrieve.
 * @returns The AfterRestRecord object with the specified ID, or undefined if not found.
 */
export function getAfterRestRecordById(
  id: string,
  journeyId: string | null,
): AfterRestRecord | undefined {
  const records = loadAfterRestRecords();
  return records.find((r) => r.id === id && r.journeyId === journeyId);
}
