import type { AfterRestRecord, AfterRestStopDetails } from "../types/afterRest";

const AFTER_REST_RECORDS_KEY = "afterRestRecords";
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

/**
 * Loads AfterRestRecord objects from localStorage.
 * @returns An array of AfterRestRecord objects loaded from localStorage.
 */
export function loadAfterRestRecords(): AfterRestRecord[] {
  const recordsJson = localStorage.getItem(AFTER_REST_RECORDS_KEY);
  if (!recordsJson) {
    return [];
  }
  try {
    return JSON.parse(recordsJson) as AfterRestRecord[];
  } catch {
    return [];
  }
}

/**
 * Saves an AfterRestRecord object to localStorage. If a record with the same ID already exists, it will be updated; otherwise, a new record will be added.
 * @param record The AfterRestRecord object to be saved.
 */
export function saveAfterRestRecord(record: AfterRestRecord) {
  const records = loadAfterRestRecords();
  const existingIndex = records.findIndex((r) => r.id === record.id);
  if (existingIndex !== -1) {
    records[existingIndex] = record;
  } else {
    records.push(record);
  }
  localStorage.setItem(AFTER_REST_RECORDS_KEY, JSON.stringify(records));
}

/**
 * Retrieves an AfterRestRecord object from localStorage by its ID.
 * @param id The ID of the AfterRestRecord to retrieve.
 * @returns The AfterRestRecord object with the specified ID, or undefined if not found.
 */
export function getAfterRestRecordById(
  id: string,
): AfterRestRecord | undefined {
  const records = loadAfterRestRecords();
  return records.find((r) => r.id === id);
}
