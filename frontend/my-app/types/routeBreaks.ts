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
  isDriverSwitchLocation: boolean;
};

// All route and break data needed by the Route & Breaks page.
export type RouteBreaksData = {
  routeGeometry: Coordinate[];
  destinations: RoutePoint[];
  restStops: PlannedSafeStop[];
  currentEta: string;
  currentActiveDriver: string;
};
