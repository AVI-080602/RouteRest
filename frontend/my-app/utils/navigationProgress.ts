import {
  NAVIGATION_PROGRESS_STORAGE_KEY,
  type NavigationProgress,
} from "@/types/navigation";

/**
 * Where the driver is up to on the current journey, as saved on the phone.
 *
 * The navigation page only saves progress once something changes (a stop
 * reached, the route re-planned), so a journey that has just started has
 * nothing saved yet. That means "heading for the first stop", not "no
 * journey": the departure (waypoint 0) is where the driver already is, and
 * the first thing to reach is waypoint 1.
 *
 * Every page reads progress through this one function so they always
 * agree. Before 12 Oct 2026 each page had its own copy, and the rest stop
 * card treated "nothing saved" as an error, so early in a trip neither its
 * "Add as Next Rest Stop" button nor Rory's spoken yes could add a stop
 * ("The current navigation plan or progress is unavailable").
 */
export function readNavigationProgress(): NavigationProgress {
  try {
    const raw = localStorage.getItem(NAVIGATION_PROGRESS_STORAGE_KEY);
    if (raw) {
      const saved: unknown = JSON.parse(raw);
      if (isNavigationProgress(saved)) {
        return saved;
      }
    }
  } catch {
    // Storage blocked or unreadable: start from the beginning, as below.
  }
  return freshNavigationProgress();
}

/** Progress for a journey that has just started. */
export function freshNavigationProgress(): NavigationProgress {
  return { nextWaypointIndex: 1, completedWaypointIds: [], rerouteCount: 0 };
}

/** A saved record with the shape the pages rely on; anything else is ignored. */
function isNavigationProgress(value: unknown): value is NavigationProgress {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    Number.isInteger(record.nextWaypointIndex) &&
    (record.nextWaypointIndex as number) >= 0 &&
    Array.isArray(record.completedWaypointIds) &&
    record.completedWaypointIds.every((id) => typeof id === "string") &&
    Number.isInteger(record.rerouteCount) &&
    (record.rerouteCount as number) >= 0
  );
}
