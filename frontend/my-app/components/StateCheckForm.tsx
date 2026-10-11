"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { ArrowLeft, ArrowRight, Check, Moon, ShieldCheck, Sun } from "lucide-react";
import { useRouter } from "@/utils/appNavigation";
import CameraMonitoringPreference from "@/components/CameraMonitoringPreference";
import type { CameraMonitoringPreference as CameraMonitoringPreferenceType } from "@/types/cameraMonitoring";
import {
  SELF_REPORTED_STATE_OPTIONS,
  type SelfReportedState,
  type SelfReportedStateValue,
  type StateCheckContext,
} from "@/types/stateCheck";
import {
  createSelfReportedState,
  loadStateCheckResult,
  saveStateCheckResult,
} from "@/utils/stateCheckStorage";

type StateCheckFormProps = { context: StateCheckContext };
type ThemeStyle = CSSProperties & Record<`--color-${string}`, string>;

// Scope the colour tokens to this form, including the existing camera component.
const lightTheme: ThemeStyle = {
  colorScheme: "light",
  "--color-surface": "#ffffff",
  "--color-surface-alt": "#edf3f8",
  "--color-ink": "#182b40",
  "--color-muted": "#4b6075",
  "--color-line": "#d5e0ea",
  "--color-line-strong": "#718398",
  "--color-brand": "#275dad",
  "--color-brand-strong": "#214d91",
  "--color-brand-soft": "#4678bf",
  "--color-brand-tint": "#eaf2ff",
  "--color-danger": "#b91c1c",
};
const darkTheme: ThemeStyle = {
  colorScheme: "dark",
  "--color-surface": "#172437",
  "--color-surface-alt": "#203148",
  "--color-ink": "#f2f6fc",
  "--color-muted": "#b7c6d9",
  "--color-line": "#35465d",
  "--color-line-strong": "#7b90ac",
  "--color-brand": "#3269ba",
  "--color-brand-strong": "#b5d1ff",
  "--color-brand-soft": "#8bbaff",
  "--color-brand-tint": "#233d60",
  "--color-danger": "#ffaaa5",
};

const stateDescriptions: Record<SelfReportedStateValue, string> = {
  not_sleepy: "I feel alert and awake.",
  slightly_sleepy: "I feel a little tired.",
  very_sleepy: "I am finding it hard to stay alert.",
  dozing_off: "I am struggling to stay awake.",
};

const formatUpdateTime = (updatedAt: string) =>
  new Intl.DateTimeFormat("en-AU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(updatedAt));

export default function StateCheckForm({ context }: StateCheckFormProps) {
  const router = useRouter();
  // Theme selection is local to this component and resets on remount.
  const [isDark, setIsDark] = useState(false);
  const [currentState, setCurrentState] = useState<SelfReportedState | null>(null);
  const [cameraPreference, setCameraPreference] =
    useState<CameraMonitoringPreferenceType | null>(null);

  // Restore the existing self-report without changing the storage format.
  useEffect(() => {
    queueMicrotask(() => setCurrentState(loadStateCheckResult()));
  }, []);

  function selectSelfReportedState(value: SelfReportedStateValue) {
    const newState = createSelfReportedState(value, context);
    saveStateCheckResult(newState);
    setCurrentState(newState);
  }

  const updateCameraPreference = useCallback(
    (preference: CameraMonitoringPreferenceType | null) => {
      setCameraPreference(preference);
    },
    [],
  );

  function continueToRouteBreaks() {
    if (!currentState || !cameraPreference) return;
    router.push("/route-breaks");
  }

  const focusClass =
    "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-soft";

  return (
    <section
      style={isDark ? darkTheme : lightTheme}
      className={`min-h-svh text-ink transition-colors ${
        isDark
          ? "bg-[linear-gradient(160deg,#0b1423,#142239)]"
          : "bg-[linear-gradient(160deg,#dcebf8_0%,#f1f5f9_55%,#faeee7_100%)]"
      } [&_button]:focus-visible:outline-2 [&_button]:focus-visible:outline-offset-4 [&_button]:focus-visible:outline-brand-soft [&_button]:disabled:cursor-not-allowed [&_button.bg-brand]:hover:enabled:bg-brand [&_button.bg-brand]:active:enabled:bg-brand [&_button.bg-brand]:hover:enabled:brightness-110 [&_button.text-brand]:text-brand-strong`}
    >
      <div className="mx-auto flex min-h-svh w-full max-w-2xl flex-col px-4 py-5 sm:px-8 sm:py-8">
        <header className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => window.history.back()}
            aria-label="Go back"
            className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-line-strong bg-surface ${focusClass}`}
          >
            <ArrowLeft className="h-5 w-5" aria-hidden="true" />
          </button>
          <span className="text-sm font-bold tracking-wide">RouteRest</span>
          <button
            type="button"
            onClick={() => setIsDark((value) => !value)}
            aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
            className={`inline-flex min-h-11 items-center gap-2 rounded-full border border-line-strong bg-surface px-3 text-xs font-semibold sm:text-sm ${focusClass}`}
          >
            {isDark ? <Sun className="h-4 w-4" aria-hidden="true" /> : <Moon className="h-4 w-4" aria-hidden="true" />}
            {isDark ? "Light mode" : "Dark mode"}
          </button>
        </header>

        <div className="pb-6 pt-8">
          <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted">
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            {context === "after-rest" ? "After-rest check" : "Driver safety"}
          </p>
          <h1 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl">State Check</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">Take a moment to check how you feel before continuing.</p>
        </div>

        <section aria-labelledby="sleepiness-heading" className="rounded-2xl border border-line bg-surface p-4 shadow-sm sm:p-5">
          <h2 id="sleepiness-heading" className="text-lg font-bold">How sleepy do you feel?</h2>
          <p className="mt-1 text-sm text-muted">Choose the option that best describes you now.</p>
          <div className="mt-4 grid gap-3">
            {SELF_REPORTED_STATE_OPTIONS.map((option) => {
              const isSelected = currentState?.value === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => selectSelfReportedState(option.value)}
                  className={`flex min-h-20 items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${focusClass} ${isSelected ? "border-brand-soft bg-brand-tint" : "border-line-strong bg-surface hover:bg-surface-alt"}`}
                >
                  <span aria-hidden="true" className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${isSelected ? "border-brand bg-brand text-white" : "border-line-strong"}`}>
                    {isSelected && <Check className="h-4 w-4" />}
                  </span>
                  <span>
                    <span className="block text-sm font-bold sm:text-base">{option.label}</span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-muted sm:text-sm">{stateDescriptions[option.value]}</span>
                  </span>
                </button>
              );
            })}
          </div>
          {currentState && (
            <div className="mt-4 rounded-xl bg-surface-alt px-3 py-3 text-xs leading-relaxed text-muted">
              <p>Current state: <span className="font-semibold text-ink">{currentState.label}</span></p>
              <p>Source: {currentState.source}</p>
              <p>Updated: {formatUpdateTime(currentState.updatedAt)}</p>
            </div>
          )}
        </section>

        {/* Inherited colour tokens also theme the camera preview and information dialog. */}
        <div className="mt-4 [&>section]:rounded-2xl [&>section]:shadow-sm">
          <CameraMonitoringPreference
            stateCheckCompleted={currentState !== null}
            onPreferenceChange={updateCameraPreference}
          />
        </div>

        <footer className="mt-auto pt-6 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <p className="mb-4 text-xs leading-relaxed text-muted">Completing this check does not confirm that it is safe to drive.</p>
          <button
            type="button"
            disabled={!currentState || !cameraPreference}
            onClick={continueToRouteBreaks}
            className={`inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 py-3 text-sm font-bold text-white transition disabled:opacity-50 ${focusClass}`}
          >
            Continue to Route &amp; Breaks
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </button>
          {currentState && !cameraPreference && (
            <p className="mt-3 text-center text-xs text-muted">Choose whether to enable camera monitoring before continuing.</p>
          )}
        </footer>
      </div>
    </section>
  );
}
