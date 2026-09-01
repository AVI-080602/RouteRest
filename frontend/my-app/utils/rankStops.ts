// Define what information every ranked stop must contain
export type RankedStop = {
  id: string;
  name: string;
  score: number;
  rankingReason: string;
  hasLighting: boolean;
  hasHeavyVehicleParking: boolean;
  fuelTypes: string[];
};

// Return the reason why this stop was ranked this way
export function getRankingReason(stop: RankedStop): string {
  return stop.rankingReason;
}

// Increase the score if the stop is suitable for night-time use
export function applyNightTimeRanking(
  stop: RankedStop,
  isNightTime: boolean
): RankedStop {
  // Only give extra points at night, and only when both facilities are available
  if (
    isNightTime &&
    stop.hasLighting &&
    stop.hasHeavyVehicleParking
  ) {
    return {
      // Copy all existing stop information
      ...stop,
      // Add 20 points to the current score
      score: stop.score + 20,
      // Explain why this stop received extra points
      rankingReason: "Lighting and heavy-vehicle parking available",
    };
  }
  // If the condition is not met, return the original stop unchanged
  return stop;
}
// Increase the score if fuel is needed and the stop supports the required fuel type
export function applyFuelRanking(
  stop: RankedStop,
  fuelNeeded: boolean,
  selectedFuelType: string
): RankedStop {
  // Only give extra points when fuel is needed
  // and this stop supports the selected fuel type
  if (
    fuelNeeded &&
    stop.fuelTypes.includes(selectedFuelType)
  ) {
    return {
      // Copy all existing stop information
      ...stop,

      // Add 20 points to the current score
      score: stop.score + 20,

      // Explain why this stop received extra points
      rankingReason: `Compatible ${selectedFuelType} fuel available`,
    };
  }

  // If the condition is not met, return the original stop unchanged
  return stop;
}