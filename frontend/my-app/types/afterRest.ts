import { Coordinate } from "@/types/routeBreaks";

export type AfterRestStopDetails = {
  id: string;
  stopName: string;
  requiredRestMins: number | null;
  locationLabel?: string;
  coordinate?: Coordinate;
};

export type AfterRestRecord = {
  id: string;
  stopName: string;
  requiredRestMins: number | null;
  punchInAt: number | null;
  punchOutAt: number | null;
  actualRestMins: number | null;
  completed: boolean;
  locationLabel?: string;
  coordinate?: Coordinate;
};
