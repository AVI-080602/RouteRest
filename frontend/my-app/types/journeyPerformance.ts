export type JourneySafetySummary = {
  id: string;

  navigationStartedAt: string;

  completedAt: string;

  departureName: string;

  destinationNames: string[];

  plannedDistanceKm: number;

  /**
   * Time from starting navigation until finishing the journey.
   * This includes waiting and rest, so it is not labelled driving time.
   */
  navigationSessionMinutes: number | null;

  plannedRestStops: number;

  completedRestStops: number;

  confirmedRestMinutes: number;

  rerouteCount: number;
};