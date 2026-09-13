import { RestBreak } from "@/types/journeyDetails";
import { Coordinate } from "@/types/routeBreaks";

/**
 * The hand-off between the Route & Breaks page and in-app navigation.
 *
 * Route & Breaks writes one of these to localStorage under
 * NAVIGATION_PLAN_STORAGE_KEY when the driver taps Start Navigation, and
 * the /navigate page reads it back. Like every other piece of journey
 * state it never leaves the device (see the data management plan: no
 * personal journey data is stored server-side).
 */

export const NAVIGATION_PLAN_STORAGE_KEY = "currentNavigationPlan";
export const NAVIGATION_PROGRESS_STORAGE_KEY = "currentNavigationProgress";

/** One turn instruction from OpenRouteService, as passed through by the
 * backend's /journeys/route. start_index/end_index are indices into the
 * route geometry, so the navigation page can tell which instruction
 * applies to the driver's current position. */
export type RouteStep = {
  instruction: string;
  distance_m: number;
  duration_s: number;
  start_index: number;
  end_index: number;
};

export type NavigationWaypoint = Coordinate & {
  kind: "departure" | "stop" | "destination";
  id: string;
  name: string;
  shortName: string;
  // Present for kind === "stop" only.
  restBreak?: RestBreak;
  facilities?: string[];
};

export type NavigationPlan = {
  // In visiting order: departure first, destination last, stops and
  // intermediate destinations in between in along-route order.
  waypoints: NavigationWaypoint[];
  geometry: Coordinate[];
  // Empty when the backend predates turn instructions; the navigation
  // page copes without them (distance to next stop still works).
  steps: RouteStep[];
  distanceKm: number;
  durationHours: number;
  // ISO local datetime string, e.g. "2026-09-11T08:00:00".
  departureDateTime: string;
  createdAt: string;
};

/** Where the driver is up to, so a reload mid-drive resumes in place. */
export type NavigationProgress = {
  // Index into NavigationPlan.waypoints of the NEXT waypoint to reach.
  nextWaypointIndex: number;
  completedWaypointIds: string[];
  rerouteCount: number;
};
