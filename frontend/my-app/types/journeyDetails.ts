export type JourneyDetails = {
  destination: string[];
  vehicleType: string;
  fuelType: string;
  fuelLevel: number;
  departureDate: string;
  departureTime: string;
  arrivalDate: string;
  arrivalTime: string;
  coDriver: string;
};

export type JourneyDetailsError = {
  destination: string;
  vehicleType: string;
  fuelType: string;
  fuelLevel: string;
  departureDate: string;
  departureTime: string;
  arrivalDate: string;
  arrivalTime: string;
  coDriver: string;
};
