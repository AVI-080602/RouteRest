// Track completion only, not whether the driver reported feeling alert.
export type PerformanceCheck = {
  completed: boolean | null;
  completedAt: string | null;
};

export type PerformanceRest = {
  waypointId: string;
  requiredMinutes: number;
  actualMinutes: number | null;
  status: "planned" | "resting" | "completed" | "skipped";

  // Not applicable until this rest has been completed.
  afterRestCheck: PerformanceCheck | null;
};

export type JourneyPerformanceRecord = {
  schemaVersion: 1;
  scoringVersion: "v1";
  journeyId: string;
  startedAt: string;
  completedAt: string | null;
  status: "in_progress" | "completed";

  // A journey that used simulated movement must not affect real ratings.
  isSimulation: boolean;

  preDepartureCheck: PerformanceCheck;
  rests: PerformanceRest[];
};

export type JourneySafetySummary = {
  id: string;
  journeyId?: string;

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

export type JourneyPerformanceRequest = {
  journey_id: string;
  status: "completed";
  rests: {
    required_minutes: number;
    actual_minutes: number | null;
  }[];
  checks: (boolean | null)[];
  previous_total: number;
  previous_count: number;
};

export type ScoredJourney = {
  status: "scored";
  scoring_version: "v1";
  journey_score: number;
  rest_points: number | null;
  check_points: number;
  rest_applicable: boolean;
};

export type OverallRating = {
  total_score: number;
  journey_count: number;
  previous_average: number | null;
  overall_average: number;
  change: number | null;
};

export type JourneyPerformanceResponse =
  | {
      journey_id: string;
      journey: ScoredJourney;
      overall: OverallRating;
    }
  | {
      journey_id: string;
      journey: {
        status: "insufficient_data";
        scoring_version: "v1";
      };
      overall: null;
    };
