import { isJourneyPerformanceRecord } from "@/utils/journeyPerformanceValidation";

type RestEvidence = {
  stopName: string;
  plannedMinutes: number;
  recordedMinutes: number;
};

export type JourneyFeedback =
  | { kind: "insufficient_data" }
  | { kind: "no_planned_rests"; message: string }
  | {
      kind: "improvement" | "positive";
      title: string;
      message: string;
      evidence: RestEvidence;
      partial: boolean;
    };

/** Read-only, deterministic feedback. Does not calculate scores or use AI. */
export function getJourneyFeedback(
  journeyId: string | null,
  data: unknown,
): JourneyFeedback {
  const insufficient: JourneyFeedback = { kind: "insufficient_data" };
  if (
    !journeyId?.trim() ||
    !isJourneyPerformanceRecord(data) ||
    data.journeyId !== journeyId ||
    data.status !== "completed" ||
    data.completedAt === null ||
    Date.parse(data.completedAt) < Date.parse(data.startedAt) ||
    data.isSimulation ||
    new Set(data.rests.map((rest) => rest.waypointId)).size !==
      data.rests.length
  ) {
    return insufficient;
  }

  // An explicitly empty plan is different from missing or unrecorded rests.
  if (data.rests.length === 0) {
    return {
      kind: "no_planned_rests",
      message:
        "No rest breaks were planned for this journey. Rest feedback is not applicable.",
    };
  }

  const recorded = data.rests.flatMap((rest): RestEvidence[] => {
    if (
      rest.status !== "completed" ||
      rest.actualMinutes === null ||
      !rest.stopName?.trim()
    )
      return [];
    return [
      {
        stopName: rest.stopName.trim(),
        plannedMinutes: rest.requiredMinutes,
        recordedMinutes: rest.actualMinutes,
      },
    ];
  });
  if (recorded.length === 0) return insufficient;

  // Select the first short recorded break in plan order, never an unrecorded one.
  const short = recorded.find(
    (rest) => rest.recordedMinutes < rest.plannedMinutes,
  );
  const partial = recorded.length !== data.rests.length;
  if (short) {
    return {
      kind: "improvement",
      title: "Allow time for the full planned break",
      message:
        "For future similar journeys, allow enough time at this stop to complete the planned rest duration.",
      evidence: short,
      partial,
    };
  }
  return {
    kind: "positive",
    title: partial
      ? "This recorded break met the plan"
      : "Planned rest durations met",
    message: partial
      ? "Your recorded rest at this stop met its planned duration."
      : `All ${recorded.length} planned rest ${recorded.length === 1 ? "break" : "breaks"} met the planned duration.`,
    evidence: recorded[0],
    partial,
  };
}
