"use client";

import { AudioLines, Mic, MicOff } from "lucide-react";
import type { RoryListenerStatus } from "@/hooks/useRoryListener";
import { GHOST_BUTTON_CLASS, SECONDARY_BUTTON_CLASS } from "@/utils/ui";

/**
 * Rory's strip under the navigation header: whether Rory is listening,
 * what it last heard, and the two controls that need a tap (starting the
 * microphone after a reload, and turning Rory off).
 *
 * The last sentence heard is shown for a few seconds so a driver (or a
 * tester) can see what Rory understood when an answer seems wrong. It is
 * never stored.
 */
type Props = {
  status: RoryListenerStatus;
  progress: { loaded: number; total: number } | null;
  heard: string | null;
  onStart: () => void;
  onToggle: () => void;
};

function megabytes(bytes: number) {
  return Math.round(bytes / 1_000_000);
}

export default function RoryStatus({
  status,
  progress,
  heard,
  onStart,
  onToggle,
}: Props) {
  let icon = <Mic className="h-5 w-5 shrink-0 text-brand" aria-hidden />;
  let message: React.ReactNode;
  let action: React.ReactNode = null;

  switch (status) {
    case "listening":
      message = (
        <>
          Say <span className="font-bold">&ldquo;Hey Rory&rdquo;</span> to ask
          about your journey.
        </>
      );
      break;
    case "loading":
      icon = <AudioLines className="h-5 w-5 shrink-0 text-muted" aria-hidden />;
      message =
        progress && progress.total > 0 && progress.loaded < progress.total
          ? `Getting Rory ready: ${megabytes(progress.loaded)} of ${megabytes(progress.total)} MB. This happens once; Wi-Fi is best.`
          : "Getting Rory ready...";
      break;
    case "needs-tap":
      message = "Rory needs a tap before the browser will let it listen.";
      action = (
        <button
          type="button"
          onClick={onStart}
          className={SECONDARY_BUTTON_CLASS}
        >
          Start Rory
        </button>
      );
      break;
    case "denied":
      icon = <MicOff className="h-5 w-5 shrink-0 text-danger" aria-hidden />;
      message =
        "Rory needs the microphone. Allow it for this site in the browser settings, then tap Try again.";
      action = (
        <button
          type="button"
          onClick={onStart}
          className={SECONDARY_BUTTON_CLASS}
        >
          Try again
        </button>
      );
      break;
    case "unsupported":
      icon = <MicOff className="h-5 w-5 shrink-0 text-muted" aria-hidden />;
      message =
        "Rory isn't available in this browser. Voice directions and warnings still work.";
      break;
    case "failed":
      icon = <MicOff className="h-5 w-5 shrink-0 text-muted" aria-hidden />;
      message =
        "Rory couldn't start. Voice directions and warnings still work.";
      break;
    case "off":
      icon = <MicOff className="h-5 w-5 shrink-0 text-muted" aria-hidden />;
      message = "Rory is off.";
      break;
  }

  return (
    <section
      aria-label="Rory, voice companion"
      className="flex flex-col gap-2 rounded-xl border border-line bg-surface-alt px-4 py-2 text-sm text-ink sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex min-w-0 items-start gap-2">
        {icon}
        <div className="min-w-0">
          <p>{message}</p>
          {heard && (
            <p
              className="mt-0.5 truncate text-xs text-muted"
              aria-live="polite"
            >
              Heard: &ldquo;{heard.toLowerCase()}&rdquo;
            </p>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {action}
        {status !== "unsupported" && (
          <button
            type="button"
            onClick={onToggle}
            aria-pressed={status !== "off"}
            className={GHOST_BUTTON_CLASS}
          >
            {status === "off" ? "Turn Rory on" : "Turn Rory off"}
          </button>
        )}
      </div>
    </section>
  );
}
