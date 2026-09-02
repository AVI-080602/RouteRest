// Data structure used by the stop ranking system
export type RankedStop = {
  id: string;
  name: string;
  score: number;
  rankingReasons: string[];

  isHeavyVehicleSuitable: boolean;
  hasLighting: boolean;
  hasHeavyVehicleParking: boolean;

  fuelTypes: string[];

  minutesFromRecommendedRest: number;
  detourDistanceKm: number;

  facilities: string[];
};

// Return all reasons that contributed to this stop's ranking
export function getRankingReasons(stop: RankedStop): string[] {
  return stop.rankingReasons;
}

// Give extra priority to stops that are safer for night-time use
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
      rankingReasons: [
        ...stop.rankingReasons,
        "Lighting and heavy-vehicle parking available",
      ],
    };
  }

  return stop;
}

// Prioritise stops that provide the required fuel type when fuel is needed
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
      rankingReasons: [
        ...stop.rankingReasons,
        `Compatible ${selectedFuelType} fuel available`,
      ],
    };
  }

  return stop;
}

// Prioritise heavy-vehicle stops that can be reached close to the recommended rest time
export function applyRestTimingRanking(
  stop: RankedStop,
  restDueSoon: boolean
): RankedStop {
  if (
    restDueSoon &&
    stop.hasHeavyVehicleParking &&
    stop.minutesFromRecommendedRest <= 30
  ) {
    return {
      ...stop,
      score: stop.score + 25,
      rankingReasons: [
        ...stop.rankingReasons,
        "Close to the recommended rest time",
      ],
    };
  }

  return stop;
}

// Current journey conditions used when ranking stops
export type JourneyNeeds = {
  isNightTime: boolean;

  fuelNeeded: boolean;
  selectedFuelType: string;

  restDueSoon: boolean;

  requiredFacilities: string[];
};

// Prefer stops that require less detour from the current route
export function applyDetourRanking(
  stop: RankedStop
): RankedStop {
  if (stop.detourDistanceKm <= 5) {
    return {
      ...stop,
      score: stop.score + 15,
      rankingReasons: [
        ...stop.rankingReasons,
        "Short detour distance",
      ],
    };
  }

  if (stop.detourDistanceKm <= 10) {
    return {
      ...stop,
      score: stop.score + 8,
      rankingReasons: [
        ...stop.rankingReasons,
        "Reasonable detour distance",
      ],
    };
  }

  return stop;
}

// Give extra priority when all required facilities are available
export function applyFacilityRanking(
  stop: RankedStop,
  requiredFacilities: string[]
): RankedStop {
  if (requiredFacilities.length === 0) {
    return stop;
  }

  const hasAllRequiredFacilities =
    requiredFacilities.every((facility) =>
      stop.facilities.includes(facility)
    );

  if (hasAllRequiredFacilities) {
    return {
      ...stop,
      score: stop.score + 20,
      rankingReasons: [
        ...stop.rankingReasons,
        "Required facilities available",
      ],
    };
  }

  return stop;
}

// Heavy-vehicle suitability is treated as an essential ranking factor
export function applyHeavyVehicleRanking(
  stop: RankedStop
): RankedStop {
  if (stop.isHeavyVehicleSuitable) {
    return {
      ...stop,
      score: stop.score + 30,
      rankingReasons: [
        ...stop.rankingReasons,
        "Suitable for heavy vehicles",
      ],
    };
  }

  return stop;
}

// Apply all ranking rules, then return stops from highest to lowest score
export function rankStops(
  stops: RankedStop[],
  needs: JourneyNeeds
): RankedStop[] {
  return stops
    .map((stop) => {
      // Reset previous ranking results before recalculating
      let rankedStop: RankedStop = {
        ...stop,
        score: 0,
        rankingReasons: [],
      };

      rankedStop =
        applyHeavyVehicleRanking(rankedStop);

      rankedStop =
        applyNightTimeRanking(
          rankedStop,
          needs.isNightTime
        );

      rankedStop =
        applyFuelRanking(
          rankedStop,
          needs.fuelNeeded,
          needs.selectedFuelType
        );

      rankedStop =
        applyRestTimingRanking(
          rankedStop,
          needs.restDueSoon
        );

      rankedStop =
        applyDetourRanking(rankedStop);
        

      rankedStop =
        applyFacilityRanking(
          rankedStop,
          needs.requiredFacilities
        );

      return rankedStop;
    })
    .sort((a, b) => b.score - a.score);
}