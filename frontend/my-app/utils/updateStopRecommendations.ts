import {
  RankedStop,
  JourneyNeeds,
  rankStops,
} from "./rankStops";

import {
  JourneyDetails,
  RestBreak,
} from "../types/journeyDetails";

// Result returned after stop recommendations are refreshed
export type StopRecommendationUpdate = {
  rankedStops: RankedStop[];

  restAndRefuelStops: RankedStop[];

  replacementStops: RankedStop[];

  selectedStop: RankedStop | null;

  selectedStopStillSuitable: boolean;

  selectedStopUnsuitableReasons: string[];

  journeyChanged: boolean;

  fuelInformationChanged: boolean;

  updatedETA: string | null;

  totalRestMinutes: number;
};

// Compare two destination lists
function destinationsChanged(
  oldJourney: JourneyDetails,
  newJourney: JourneyDetails
): boolean {
  if (
    oldJourney.destination.length !==
    newJourney.destination.length
  ) {
    return true;
  }

  return oldJourney.destination.some(
    (destination, index) => {
      const newDestination =
        newJourney.destination[index];

      return (
        destination.id !== newDestination?.id ||
        destination.label !== newDestination?.label
      );
    }
  );
}

// Check whether route or schedule information changed
export function hasRouteOrScheduleChanged(
  oldJourney: JourneyDetails,
  newJourney: JourneyDetails
): boolean {
  return (
    oldJourney.departureLocation !==
      newJourney.departureLocation ||

    destinationsChanged(
      oldJourney,
      newJourney
    ) ||

    oldJourney.departureDate !==
      newJourney.departureDate ||

    oldJourney.departureTime !==
      newJourney.departureTime ||

    oldJourney.arrivalDate !==
      newJourney.arrivalDate ||

    oldJourney.arrivalTime !==
      newJourney.arrivalTime ||

    oldJourney.coDriver !==
      newJourney.coDriver ||

    oldJourney.estimatedDrivingHours !==
      newJourney.estimatedDrivingHours ||

    oldJourney.jurisdictionCode !==
      newJourney.jurisdictionCode
  );
}

// Check whether fuel information changed
export function hasFuelInformationChanged(
  oldJourney: JourneyDetails,
  newJourney: JourneyDetails
): boolean {
  return (
    oldJourney.fuelType !==
      newJourney.fuelType ||

    oldJourney.fuelLevel !==
      newJourney.fuelLevel
  );
}

// Check whether any Journey information relevant to stop recommendations changed
export function hasRelevantJourneyChange(
  oldJourney: JourneyDetails,
  newJourney: JourneyDetails
): boolean {
  return (
    hasRouteOrScheduleChanged(
      oldJourney,
      newJourney
    ) ||
    hasFuelInformationChanged(
      oldJourney,
      newJourney
    )
  );
}

// Return reasons why a selected stop is no longer suitable
export function getStopUnsuitableReasons(
  stop: RankedStop,
  needs: JourneyNeeds
): string[] {
  const reasons: string[] = [];

  if (!stop.isHeavyVehicleSuitable) {
    reasons.push(
      "Not suitable for heavy vehicles"
    );
  }

  if (
    needs.fuelNeeded &&
    !stop.fuelTypes.includes(
      needs.selectedFuelType
    )
  ) {
    reasons.push(
      `Required ${needs.selectedFuelType} fuel is not available`
    );
  }

  const missingFacilities =
    needs.requiredFacilities.filter(
      (facility) =>
        !stop.facilities.includes(facility)
    );

  if (missingFacilities.length > 0) {
    reasons.push(
      `Missing required facilities: ${missingFacilities.join(
        ", "
      )}`
    );
  }

  if (
    needs.restDueSoon &&
    stop.minutesFromRecommendedRest > 30
  ) {
    reasons.push(
      "Stop is too far from the recommended rest time"
    );
  }

  return reasons;
}

// Convert JourneyDetails into the JourneyNeeds format used by US 2.2
export function buildJourneyNeeds(
  journey: JourneyDetails,
  options?: {
    isNightTime?: boolean;
    restDueSoon?: boolean;
    requiredFacilities?: string[];
  }
): JourneyNeeds {
  const fuelLevel =
    journey.fuelLevel.trim().toLowerCase();

  const fuelNeeded =
    fuelLevel === "low" ||
    fuelLevel === "empty" ||
    fuelLevel === "critical" ||
    fuelLevel === "25%" ||
    fuelLevel === "0%";

  return {
    isNightTime:
      options?.isNightTime ?? false,

    fuelNeeded,

    selectedFuelType:
      journey.fuelType,

    restDueSoon:
      options?.restDueSoon ?? false,

    requiredFacilities:
      options?.requiredFacilities ?? [],
  };
}

// Calculate the total planned rest time in minutes
export function calculateTotalRestMinutes(
  restBreaks: RestBreak[]
): number {
  return restBreaks.reduce(
    (total, restBreak) => {
      const start =
        new Date(restBreak.start);

      const end =
        new Date(restBreak.end);

      const durationMinutes =
        (end.getTime() - start.getTime()) /
        (1000 * 60);

      return total + durationMinutes;
    },
    0
  );
}

// Calculate an updated ETA using departure time,
// estimated driving time, and planned rest time
export function calculateUpdatedETA(
  journey: JourneyDetails,
  restBreaks: RestBreak[]
): string | null {
  const drivingHours =
    Number(journey.estimatedDrivingHours);

  if (
    Number.isNaN(drivingHours) ||
    drivingHours < 0
  ) {
    return null;
  }

  const departureDateTime =
    new Date(
      `${journey.departureDate}T${journey.departureTime}`
    );

  if (
    Number.isNaN(
      departureDateTime.getTime()
    )
  ) {
    return null;
  }

  const totalRestMinutes =
    calculateTotalRestMinutes(
      restBreaks
    );

  const drivingMinutes =
    drivingHours * 60;

  const totalJourneyMinutes =
    drivingMinutes +
    totalRestMinutes;

  const arrivalDateTime =
    new Date(
      departureDateTime.getTime() +
        totalJourneyMinutes *
          60 *
          1000
    );

  return arrivalDateTime.toISOString();
}

// Refresh rankings and check whether the previously selected stop can be retained
export function updateStopRecommendations(
  stops: RankedStop[],
  oldJourney: JourneyDetails,
  newJourney: JourneyDetails,
  selectedStopId: string | null,
  options?: {
    isNightTime?: boolean;
    restDueSoon?: boolean;
    requiredFacilities?: string[];
    updatedStops?: RankedStop[];
    restBreaks?: RestBreak[];
  }
    // Updated stop data from route/rest calculations.
    // US 1.3 or routing can provide this later.
  ): StopRecommendationUpdate {
  const journeyChanged =
    hasRouteOrScheduleChanged(
      oldJourney,
      newJourney
    );

  const fuelInformationChanged =
    hasFuelInformationChanged(
      oldJourney,
      newJourney
    );

  const newNeeds =
    buildJourneyNeeds(
      newJourney,
      options
    );

  const restBreaks =
    options?.restBreaks ?? [];
  const totalRestMinutes =
    calculateTotalRestMinutes(
        restBreaks
    );

  const updatedETA =
    calculateUpdatedETA(
        newJourney,
        restBreaks
   );
  // If route/rest calculations supplied refreshed stop data,
  // use that data. Otherwise use the existing stops.
  const stopsToRank =
    options?.updatedStops ?? stops;

  const rankedStops =
    rankStops(
      stopsToRank,
      newNeeds
    );
  const restAndRefuelStops =
    rankedStops.filter(
      (stop) =>
      newNeeds.restDueSoon &&
      newNeeds.fuelNeeded &&
      stop.hasHeavyVehicleParking &&
      stop.minutesFromRecommendedRest <= 30 &&
      stop.fuelTypes.includes(
        newNeeds.selectedFuelType
      )
    );
  const suitableStops =
    rankedStops.filter(
        (stop) =>
        getStopUnsuitableReasons(
            stop,
            newNeeds
        ).length === 0
    );
  const replacementStops =
    selectedStopId === null
        ? []
        : suitableStops.filter(
            (stop) =>
            stop.id !== selectedStopId
        );
  if (selectedStopId === null) {
    return {
        rankedStops,
        restAndRefuelStops,
        replacementStops,
        selectedStop: null,
        selectedStopStillSuitable: false,
        selectedStopUnsuitableReasons: [],
        journeyChanged,
        fuelInformationChanged,
        updatedETA,
        totalRestMinutes,
    };
  }

  const selectedStop =
    rankedStops.find(
      (stop) =>
        stop.id === selectedStopId
    ) ?? null;

  if (selectedStop === null) {
    return {
        rankedStops,
        restAndRefuelStops,
        replacementStops,
        selectedStop: null,
        selectedStopStillSuitable: false,
        selectedStopUnsuitableReasons: [
            "Previously selected stop is no longer available for the updated Journey",
        ],
        journeyChanged,
        fuelInformationChanged,
        updatedETA,
        totalRestMinutes,
    };
  }

  const unsuitableReasons =
    getStopUnsuitableReasons(
      selectedStop,
      newNeeds
    );

  const selectedStopStillSuitable =
    unsuitableReasons.length === 0;

  return {
    rankedStops,
    restAndRefuelStops,
    replacementStops,
    selectedStop,
    selectedStopStillSuitable,
    selectedStopUnsuitableReasons:
        unsuitableReasons,
    journeyChanged,
    fuelInformationChanged,
    updatedETA,
    totalRestMinutes,
};
}