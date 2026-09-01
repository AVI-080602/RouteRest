export type Destination = {
  id: string;
  label: string;
};

export type JourneyDetails = {
  departureLocation: string;
  destination: Destination[];
  vehicleType: string;
  fuelType: string;
  fuelLevel: string;
  departureDate: string;
  departureTime: string;
  arrivalDate: string;
  arrivalTime: string;
  coDriver: string;
  // Stand-ins for real route data (US 1.3): once routing (OpenRouteService)
  // is wired up, jurisdictionCode and estimatedDrivingHours should be
  // computed from the actual route instead of typed in here. Kept as
  // plain manual fields for now rather than faked, so the rest-plan
  // feature is honestly limited instead of silently wrong.
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
  coDriver: string;
  jurisdictionCode: string;
  estimatedDrivingHours: string;
};

/** One rest break as returned by the backend's /journeys/rest-plan endpoint. */
export type RestBreak = {
  start: string; // ISO datetime string
  end: string; // ISO datetime string
  reason: string;
};
