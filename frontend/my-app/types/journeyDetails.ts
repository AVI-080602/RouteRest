export type Destination = {
  id: string;
  label: string;
  // Set only when the label came from picking a real geocode suggestion
  // (see newjourney/page.tsx); undefined for free-text destinations the
  // driver typed without selecting one. Anything that needs a real route
  // (POST /journeys/route) must check every destination has these before
  // calling it, and fall back honestly (not silently) when one is missing.
  lat?: number;
  lng?: number;
  // The raw geocoded state name (e.g. "Western Australia"), same source
  // and same caveat as lat/lng. Used alongside departureCoordinate's
  // state to detect a route that crosses into/out of WA or NT, see
  // newjourney/page.tsx's jurisdiction cross-border check.
  state?: string;
};

export type JourneyDetails = {
  departureLocation: string;
  // Set only when departureLocation came from picking a real geocode
  // suggestion, same caveat as Destination.lat/lng above.
  departureCoordinate: { lat: number; lng: number } | null;
  destination: Destination[];
  vehicleType: string;
  fuelType: string;
  fuelLevel: string;
  departureDate: string;
  departureTime: string;
  arrivalDate: string;
  arrivalTime: string;
  // Only presence/absence matters (it decides solo vs two_up for the
  // rest-plan calculation, see fetchRestPlan), no name is collected or
  // displayed anywhere in the app today.
  hasCoDriver: boolean;
  // estimatedDrivingHours is auto-filled from the real route's duration
  // once one exists (see newjourney/page.tsx's route-fetching effect),
  // but stays editable, a driver's own estimate can reasonably differ
  // from a routing engine's (traffic, planned non-driving stops, etc).
  // jurisdictionCode is auto-suggested from the departure's (and every
  // destination's) geocoded state, see newjourney/page.tsx's
  // jurisdiction-determination effect, also editable, both are still
  // plain form fields, not values the backend computes or trusts
  // blindly.
  jurisdictionCode: string;
  estimatedDrivingHours: string;
};

export type JourneyDetailsError = {
  departureLocation: string;
  destination: string;
  vehicleType: string;
  fuelType: string;
  fuelLevel: string;
  departureDate: string;
  departureTime: string;
  arrivalDate: string;
  arrivalTime: string;
  dateTimeRange: string;
  jurisdictionCode: string;
  estimatedDrivingHours: string;
};

/** One rest break as returned by the backend's /journeys/rest-plan endpoint. */
export type RestBreak = {
  start: string; // ISO datetime string
  end: string; // ISO datetime string
  reason: string;
};
