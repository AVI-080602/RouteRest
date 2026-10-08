import { Coordinate } from "@/types/routeBreaks";
import type { SelfReportedState } from "@/types/stateCheck";

export type AfterRestStopDetails = {
  id: string;
  stopName: string;
  requiredRestMins: number | null;
  locationLabel?: string;
  coordinate?: Coordinate;
};

export type AfterRestRecord = {
  // Missing only on legacy records, which are never reused for a new journey.
  journeyId?: string | null;
  id: string;
  stopName: string;
  requiredRestMins: number | null;
  punchInAt: number | null;
  punchOutAt: number | null;
  actualRestMins: number | null;
  completed: boolean;
  stateCheck?: SelfReportedState | null;
  locationLabel?: string;
  coordinate?: Coordinate;
};
