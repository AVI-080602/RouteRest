export const AFTER_REST_RESULT_STORAGE_KEY = "currentAfterRestResult";

export type AfterRestMethod = "self-report" | "photo";

export type AfterRestResult = {
  method: AfterRestMethod;
  writtenState: string;
  persistentSleepiness: boolean;
  completedAt: string;
  restEndedAt: string | null;
};