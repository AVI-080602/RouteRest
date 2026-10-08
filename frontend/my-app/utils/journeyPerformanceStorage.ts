import type { JourneyPerformanceRecord } from "@/types/journeyPerformance";
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
