import { RouteStep } from "@/types/navigation";

/**
 * Turn-by-turn helpers for the navigation page: which turn is next, how
 * far away it is, and what kind of arrow to draw for it.
 *
 * The one rule everything here depends on: an OpenRouteService step's
 * instruction describes the maneuver at the START of that step. On a real
 * Melbourne route, step 0 is "Head south on Warrigal Road" (geometry
 * points 0 to 23) and step 1 is "Turn left onto Burwood Highway" (points
 * 23 to 72). The left turn happens at point 23. So while the truck is
 * anywhere on step 0, the next thing the driver has to do is step 1's
 * instruction, and the distance to it is the distance to point 23.
 *
 * The first version of the navigation page showed the instruction of the
 * step the truck was already on, which is the turn it had just made
 * ("Head south on Warrigal Road, in 1.2 km"). That is why drivers testing
 * the app said upcoming turns were not shown.
 */

/** What the driver has to do, in plain terms, independent of wording. */
export type ManeuverKind =
  | "depart"
  | "left"
  | "right"
  | "sharp-left"
  | "sharp-right"
  | "slight-left"
  | "slight-right"
  | "keep-left"
  | "keep-right"
  | "straight"
  | "roundabout"
  | "exit-roundabout"
  | "u-turn"
  | "arrive";

/** OpenRouteService's maneuver codes (the step's `type`), see API.md. */
const KIND_BY_ORS_CODE: Record<number, ManeuverKind> = {
  0: "left",
  1: "right",
  2: "sharp-left",
  3: "sharp-right",
  4: "slight-left",
  5: "slight-right",
  6: "straight",
  7: "roundabout",
  8: "exit-roundabout",
  9: "u-turn",
  10: "arrive",
  11: "depart",
  12: "keep-left",
  13: "keep-right",
};

/**
 * The kind of maneuver a step is. Uses the code the backend passes
 * through from OpenRouteService when there is one. Plans saved before
 * the backend sent that code only have the English instruction, so they
 * fall back to reading it; the order of the checks matters ("Keep left"
 * and "sharp left" both contain "left").
 */
export function maneuverKind(step: RouteStep): ManeuverKind {
  if (
    typeof step.maneuver_type === "number" &&
    KIND_BY_ORS_CODE[step.maneuver_type]
  ) {
    return KIND_BY_ORS_CODE[step.maneuver_type];
  }
  const text = step.instruction.toLowerCase();
  if (text.startsWith("arrive")) return "arrive";
  if (text.startsWith("head")) return "depart";
  if (text.includes("u-turn")) return "u-turn";
  if (text.includes("roundabout")) {
    return text.startsWith("exit") ? "exit-roundabout" : "roundabout";
  }
  if (text.startsWith("keep left")) return "keep-left";
  if (text.startsWith("keep right")) return "keep-right";
  if (text.includes("sharp left")) return "sharp-left";
  if (text.includes("sharp right")) return "sharp-right";
  if (text.includes("slight left")) return "slight-left";
  if (text.includes("slight right")) return "slight-right";
  if (text.includes("left")) return "left";
  if (text.includes("right")) return "right";
  return "straight";
}

/**
 * Index of the step the vehicle is driving along, given the geometry
 * segment it is on (the segment from point `segmentIndex` to the next).
 *
 * A step owns the segments from its start_index up to, but not including,
 * its end_index. Zero-length steps (an "Arrive" at a single point) own no
 * segment, so the vehicle is never "on" one; they only ever appear as the
 * next maneuver. Returns -1 when there are no steps.
 */
export function activeStepIndex(
  steps: RouteStep[],
  segmentIndex: number,
): number {
  if (steps.length === 0) {
    return -1;
  }
  for (let k = 0; k < steps.length; k += 1) {
    const step = steps[k];
    if (
      step.end_index > step.start_index &&
      segmentIndex >= step.start_index &&
      segmentIndex < step.end_index
    ) {
      return k;
    }
  }
  // Past the end of the last driven step (sitting on the final point), or
  // in a gap the steps do not cover: use the last step that has started.
  let latest = 0;
  for (let k = 0; k < steps.length; k += 1) {
    if (steps[k].start_index <= segmentIndex) {
      latest = k;
    }
  }
  return latest;
}

export type UpcomingManeuver = {
  step: RouteStep;
  kind: ManeuverKind;
  // Along-route distance from the vehicle to where this maneuver happens.
  distanceKm: number;
};

/**
 * The maneuvers still ahead of the vehicle, nearest first.
 *
 * `cumulativeKm[i]` is the along-route distance from the start of the
 * geometry to point i (see cumulativeDistancesKm in geo.ts), and
 * `vehicleAlongKm` is how far along the route the vehicle is. Working
 * from one precomputed array keeps this cheap enough to run on every GPS
 * fix, even on a route with thousands of points.
 *
 * A "depart" step in the middle of a route (setting off again after an
 * intermediate stop) is kept: it tells the driver which way to leave.
 */
export function upcomingManeuvers(
  steps: RouteStep[],
  segmentIndex: number,
  cumulativeKm: number[],
  vehicleAlongKm: number,
  limit = 8,
): UpcomingManeuver[] {
  const active = activeStepIndex(steps, segmentIndex);
  if (active < 0) {
    return [];
  }
  const upcoming: UpcomingManeuver[] = [];
  for (let k = active + 1; k < steps.length && upcoming.length < limit; k += 1) {
    const step = steps[k];
    const atKm =
      cumulativeKm[Math.min(step.start_index, cumulativeKm.length - 1)] ?? 0;
    upcoming.push({
      step,
      kind: maneuverKind(step),
      distanceKm: Math.max(0, atKm - vehicleAlongKm),
    });
  }
  return upcoming;
}
