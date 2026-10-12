import { ArrowRight, CheckCircle2, Info, TriangleAlert } from "lucide-react";
import type { JourneyFeedback } from "@/utils/journeyFeedback";
import { Link } from "@/utils/appNavigation";

const MINUTES = new Intl.NumberFormat("en-AU", { maximumFractionDigits: 2 });

export default function JourneyFeedbackCard({
  feedback,
  showExamples = false,
}: {
  feedback: JourneyFeedback;
  showExamples?: boolean;
}) {
  const insufficient = feedback.kind === "insufficient_data";
  const noPlannedRests = feedback.kind === "no_planned_rests";
  const improvement = feedback.kind === "improvement";
  const tone = improvement
    ? {
        card: "border-amber-200 border-l-amber-600 bg-amber-50 dark:border-amber-800 dark:border-l-amber-400 dark:bg-amber-950/40",
        icon: "bg-amber-700 text-white dark:bg-amber-300 dark:text-amber-950",
        accent: "text-amber-900 dark:text-amber-200",
      }
    : insufficient
      ? {
          card: "border-line border-l-line-strong bg-surface",
          icon: "bg-surface-alt text-muted",
          accent: "text-muted",
        }
      : {
          card: "border-line border-l-brand bg-brand-tint",
          icon: "bg-brand text-white",
          accent: "text-brand-strong",
        };
  const Icon = insufficient
    ? Info
    : feedback.kind === "positive" || noPlannedRests
      ? CheckCircle2
      : TriangleAlert;
  return (
    <section
      aria-labelledby="journey-feedback-title"
      className={`rounded-3xl border border-l-4 p-5 sm:p-6 ${tone.card}`}
    >
      <div className="flex items-center gap-3">
        <span
          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${tone.icon}`}
        >
          <Icon className="h-6 w-6" aria-hidden />
        </span>
        <div>
          <p
            className={`text-xs font-bold uppercase tracking-wider ${tone.accent}`}
          >
            {insufficient
              ? "Waiting for records"
              : noPlannedRests
                ? "No planned rests"
                : feedback.kind === "improvement"
                  ? "Suggestion for next time"
                  : "Positive feedback"}
          </p>
          <h2
            id="journey-feedback-title"
            className="mt-1 text-2xl font-bold tracking-tight text-ink"
          >
            Journey feedback
          </h2>
        </div>
      </div>
      {noPlannedRests ? (
        <p className="mt-5 text-base leading-relaxed text-ink">
          {feedback.message}
        </p>
      ) : insufficient ? (
        <div className="mt-5">
          <h3 className="text-lg font-bold text-ink">
            No feedback available yet
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Insufficient records. Feedback is not available yet.
          </p>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Feedback needs a completed journey and rest records with the stop
            name, planned duration and recorded duration.
          </p>
          {showExamples && (
            <Link
              href="/performance/demo"
              className="mt-4 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-action px-4 py-3 text-sm font-semibold text-on-action hover:bg-action-strong"
            >
              See feedback examples{" "}
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          )}
        </div>
      ) : (
        <>
          <h3 className="mt-5 text-xl font-bold text-ink">{feedback.title}</h3>
          <p className="mt-2 text-base leading-relaxed text-ink">
            {feedback.message}
          </p>
          <div className="mt-5 rounded-2xl border border-line bg-surface p-4">
            <p className="text-sm font-bold text-ink">Why this feedback?</p>
            <p className="mt-2 text-xs font-semibold text-muted">
              Recorded rest at
            </p>
            <p className="mt-1 break-words text-sm font-bold text-ink">
              {feedback.evidence.stopName}
            </p>
            <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-muted">Planned duration</dt>
                <dd className="mt-1 text-xl font-bold text-ink">
                  {MINUTES.format(feedback.evidence.plannedMinutes)} min
                </dd>
              </div>
              <div>
                <dt className="text-muted">Recorded duration</dt>
                <dd className={`mt-1 text-xl font-bold ${tone.accent}`}>
                  {feedback.kind === "improvement" &&
                  MINUTES.format(feedback.evidence.recordedMinutes) ===
                    MINUTES.format(feedback.evidence.plannedMinutes)
                    ? `Just under ${MINUTES.format(feedback.evidence.plannedMinutes)}`
                    : MINUTES.format(feedback.evidence.recordedMinutes)}{" "}
                  min
                </dd>
              </div>
            </dl>
          </div>
          {feedback.partial && (
            <p className="mt-3 text-xs leading-relaxed text-muted">
              Other planned rest records are incomplete. This feedback applies
              only to the recorded break shown above.
            </p>
          )}
          {feedback.kind === "improvement" && (
            <p className={`mt-3 text-xs font-semibold ${tone.accent}`}>
              For future similar journeys only.
            </p>
          )}
        </>
      )}
    </section>
  );
}
