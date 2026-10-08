import type {
  JourneyPerformanceResponse,
  OverallRating,
} from "@/types/journeyPerformance";

const NUMBER = new Intl.NumberFormat("en-AU", { maximumFractionDigits: 1 });

type Props = {
  result: JourneyPerformanceResponse | null;
  overall: OverallRating | null;
  showEmpty?: boolean;
};

// Display only: real and demo pages keep their data and persistence separate.
export default function JourneyRatingSummary({
  result,
  overall,
  showEmpty = false,
}: Props) {
  const scored = result?.journey.status === "scored" ? result.journey : null;
  const contribution = result?.overall?.change;
  if (!scored && !overall && !showEmpty) return null;

  return (
    <>
      <section
        aria-label="Journey ratings"
        className="grid grid-cols-2 gap-4 border-b border-line py-6"
      >
        <div>
          <h2 className="text-sm font-semibold text-muted">This journey</h2>
          <p className="mt-2 text-4xl font-bold text-ink">
            {scored ? NUMBER.format(scored.journey_score) : "--"}
            <span className="ml-1 text-base font-normal text-muted">/100</span>
          </p>
        </div>
        <div>
          <h2 className="text-sm font-semibold text-muted">Overall rating</h2>
          <p className="mt-2 text-4xl font-bold text-brand">
            {overall ? NUMBER.format(overall.overall_average) : "--"}
            <span className="ml-1 text-base font-normal text-muted">/100</span>
          </p>
          {overall && (
            <p className="mt-2 text-xs text-muted">
              {overall.journey_count} rated{" "}
              {overall.journey_count === 1 ? "journey" : "journeys"}
            </p>
          )}
        </div>
        {scored && (
          <p className="col-span-2 text-sm text-muted">
            {contribution === null || contribution === undefined
              ? "Your first rated journey sets your initial overall rating."
              : `Overall average change when this journey was recorded: ${contribution > 0 ? "+" : ""}${NUMBER.format(contribution)} points.`}
          </p>
        )}
      </section>
      {scored && (
        <section
          aria-label="Score breakdown"
          className="border-b border-line py-5"
        >
          <h2 className="text-base font-semibold text-ink">Score breakdown</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Rest adherence</dt>
              <dd className="font-semibold text-ink">
                {scored.rest_points === null
                  ? "Not applicable"
                  : `${NUMBER.format(scored.rest_points)} / 80`}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Checks completed</dt>
              <dd className="font-semibold text-ink">
                {NUMBER.format(scored.check_points)} /{" "}
                {scored.rest_applicable ? 20 : 100}
              </dd>
            </div>
          </dl>
        </section>
      )}
    </>
  );
}
