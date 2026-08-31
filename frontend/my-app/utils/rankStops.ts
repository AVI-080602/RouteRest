export type RankedStop = {
  id: string;
  name: string;
  score: number;
  rankingReason: string;
  hasLighting: boolean;
  hasHeavyVehicleParking: boolean;
  fuelTypes: string[];
};

export function getRankingReason(stop: RankedStop): string {
  return stop.rankingReason;
}

export function applyNightTimeRanking(
  stop: RankedStop,
  isNightTime: boolean
): RankedStop {
  if (
    isNightTime &&
    stop.hasLighting &&
    stop.hasHeavyVehicleParking
  ) {
    return {
      ...stop,
      score: stop.score + 20,
      rankingReason: "Lighting and heavy-vehicle parking available",
    };
  }

  return stop;
}

export function applyFuelRanking(
  stop: RankedStop,
  fuelNeeded: boolean,
  selectedFuelType: string
): RankedStop {
  if (
    fuelNeeded &&
    stop.fuelTypes.includes(selectedFuelType)
  ) {
    return {
      ...stop,
      score: stop.score + 20,
      rankingReason: `Compatible ${selectedFuelType} fuel available`,
    };
  }

  return stop;
}