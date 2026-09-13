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
  distanceKm: number;
  estimatedArrivalTime: string;
  facilities: string[];
  // The legal rest requirement this physical stop is planned to satisfy.
  restBreak: RestBreak;
  isDriverSwitchLocation: boolean;
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
};
