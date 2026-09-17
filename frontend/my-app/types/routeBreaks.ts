import { RestBreak } from "@/types/journeyDetails";

// A single map coordinate using latitude and longitude.
export type Coordinate = {
  lat: number;
  lng: number;
};

// A named point on the journey, such as the departure point or destination.
export type RoutePoint = {
  label: string;
  coordinate: Coordinate;
};

// A planned safe stop selected for the journey route.
export type PlannedSafeStop = {
  id: string;
  name: string;
  coordinate: Coordinate;
  // How far into the trip this stop falls, measured from the departure.
  distanceKm: number;
  estimatedArrivalTime: string;
  facilities: string[];
  // The legal rest requirement this physical stop is planned to satisfy.
  restBreak: RestBreak;
  isDriverSwitchLocation: boolean;
  // How far the rest area sits off the route itself (US 2.1: the driver
  // needs the detour, not just the trip position). Undefined while the
  // backend match has not come back yet.
  detourKm?: number;
  // The road the rest area is on, when the source data has one. Useful
  // when the rest area itself has no name.
  roadName?: string;
  // True when no rest area was confirmed near this break at all, so what
  // is shown is the point on the route rather than a real stop.
  isUnconfirmed?: boolean;
  // True when the only rest area found sits further away than the normal
  // search range (US 2.1: show the nearest option, and say it is far).
  isBeyondNormalDetour?: boolean;
};

// Everything the map needs to draw one journey. Only map inputs live
// here: summary figures (ETA, driver configuration) are rendered by the
// page itself and were removed from this type when the map stopped
// re-creating itself on every change.
export type RouteBreaksData = {
  // Empty while the real route is still being fetched. The map draws
  // nothing for the line in that case but still shows the markers.
  routeGeometry: Coordinate[];
  // null until the driver has picked a real departure suggestion. The map
  // previously guessed the departure as routeGeometry[0], which breaks
  // once geometry can be empty.
  departure: RoutePoint | null;
  destinations: RoutePoint[];
  restStops: PlannedSafeStop[];
  // Stops whose current suitability check failed (US 2.5); the map draws
  // these with a red ring so the warning is visible on the map too.
  warnedStopIds?: string[];
};

// The driver's live position while navigating (PR 3). heading is in
// degrees clockwise from north, undefined when the device cannot say.
export type VehiclePosition = Coordinate & {
  heading?: number;
  // Current speed, when known. The navigation map zooms out as the truck
  // speeds up so the driver sees further ahead on a highway.
  speedKmh?: number;
};
