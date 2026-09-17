export const REST_STATUS_STORAGE_KEY = "currentRestStatus";

export type RestState = "arrived" | "resting" | "completed";

export type RestStatusRecord = {
  navigationPlanCreatedAt: string;
  waypointId: string;
  stopName: string;
  status: RestState;
  arrivedAt: string;
  restStartedAt: string | null;
  restEndedAt: string | null;
};