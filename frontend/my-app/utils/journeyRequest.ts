import type {
  JourneyPerformanceRecord,
  JourneyPerformanceRequest,
} from "@/types/journeyPerformance";
import { isJourneyPerformanceRecord } from "@/utils/journeyPerformanceValidation";

export function buildJourneyPerformanceRequest(
  record: JourneyPerformanceRecord,
  previousTotal: number,
  previousCount: number,
): JourneyPerformanceRequest {
  if (!isJourneyPerformanceRecord(record)) {
    throw new Error("Invalid journey performance record.");
  }
  if (record.status !== "completed" || record.completedAt === null) {
    throw new Error("Complete the journey before requesting a score.");
  }
  if (record.isSimulation) {
    throw new Error("Simulated journeys cannot update real ratings.");
  }
  if (
    !Number.isSafeInteger(previousCount) ||
    previousCount < 0 ||
    !Number.isFinite(previousTotal) ||
    previousTotal < 0 ||
    previousTotal > 100 * previousCount
  ) {
    throw new Error("Invalid previous rating history.");
  }

  return {
    journey_id: record.journeyId,
    status: "completed",
    rests: record.rests.map((rest) => ({
      required_minutes: rest.requiredMinutes,
      actual_minutes: rest.actualMinutes,
    })),
    // Preserve unknown checks; missing data is not evidence of failure.
    checks: [
      record.preDepartureCheck.completed,
      ...record.rests.map((rest) => rest.afterRestCheck?.completed ?? null),
    ],
    previous_total: previousTotal,
    previous_count: previousCount,
  };
}
