/**
 * Choosing and describing a fuel station for "find the nearest fuel"
 * (Rory, AC 5.1.6).
 *
 * The stations come from the backend's copy of OpenStreetMap
 * (POST /journeys/fuel-stations/nearby, backend/src/backend/fuel_stations.py),
 * nearest first. OpenStreetMap rarely says whether a truck can get in: in
 * October 2026 only 14 of about 7,600 Australian stations were tagged for
 * heavy vehicles and about 2,200 for diesel. So the choice prefers a
 * station tagged for trucks or diesel when it is not much further away,
 * and the spoken description always says what is not confirmed.
 *
 * Pure functions, so tests/fuelStations.test.mjs can check them with Node.
 */

export type FuelStation = {
  name: string;
  brand?: string | null;
  coordinate: { lat: number; lng: number };
  /** Straight-line distance from the truck, in kilometres. */
  distance_km: number;
  /** True, false, or null when the station does not map it. */
  diesel: boolean | null;
  truck_diesel: boolean | null;
  truck_access: boolean | null;
  opening_hours?: string | null;
};

// How much further a station may be and still be preferred. A station
// tagged as open to trucks, or with truck diesel pumps, is worth up to
// 15 km more than an untagged one, because an untagged forecourt may be
// too tight for a truck. Diesel being listed is worth 3 km: most stations
// sell diesel even when the map does not say so.
export const TRUCK_PREFERENCE_KM = 15;
export const DIESEL_PREFERENCE_KM = 3;

function isForTrucks(station: FuelStation): boolean {
  return station.truck_access === true || station.truck_diesel === true;
}

/**
 * The station to suggest, or null when there is none. Stations mapped as
 * closed to trucks are already left out by the backend; this skips them
 * again in case of an older backend.
 */
export function chooseFuelStation(stations: FuelStation[]): FuelStation | null {
  const usable = stations.filter((station) => station.truck_access !== false);
  if (usable.length === 0) {
    return null;
  }
  const effectiveKm = (station: FuelStation) =>
    station.distance_km -
    (isForTrucks(station) ? TRUCK_PREFERENCE_KM : 0) -
    (station.diesel === true || station.truck_diesel === true
      ? DIESEL_PREFERENCE_KM
      : 0);
  return usable.reduce((best, station) =>
    effectiveKm(station) < effectiveKm(best) ? station : best,
  );
}

/**
 * What the map says about the station, for the voice: diesel, trucks, and
 * whether it is open all hours. Truck access is always mentioned, because
 * a driver must not assume it.
 */
export function describeFuelStation(station: FuelStation): string {
  const parts: string[] = [];
  if (station.truck_diesel === true) {
    parts.push("It has truck diesel pumps.");
  } else if (station.diesel === true) {
    parts.push("Diesel is listed.");
  } else {
    parts.push("Diesel isn't listed on the map, though most stations sell it.");
  }
  parts.push(
    station.truck_access === true
      ? "It's marked as open to trucks."
      : "Truck access isn't confirmed.",
  );
  if (station.opening_hours?.trim() === "24/7") {
    parts.push("It's open 24 hours.");
  }
  return parts.join(" ");
}

/** Labels for the card, from what the map says. */
export function fuelStationLabels(station: FuelStation): string[] {
  const labels = ["Fuel"];
  if (station.diesel === true || station.truck_diesel === true) {
    labels.push("Diesel");
  }
  if (station.truck_diesel === true) {
    labels.push("Truck diesel pumps");
  }
  if (station.truck_access === true) {
    labels.push("Trucks welcome");
  }
  if (station.opening_hours?.trim() === "24/7") {
    labels.push("Open 24 hours");
  }
  return labels;
}
