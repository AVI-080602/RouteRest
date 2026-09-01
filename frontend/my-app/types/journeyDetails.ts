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
};
