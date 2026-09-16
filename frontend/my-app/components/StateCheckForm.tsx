"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import CameraMonitoringPreference from "@/components/CameraMonitoringPreference";
import { CameraMonitoringPreference as CameraMonitoringPreferenceType } from "@/types/cameraMonitoring";
import {
  SELF_REPORTED_STATE_OPTIONS,
  SelfReportedState,
  SelfReportedStateValue,
  StateCheckContext,
} from "@/types/stateCheck";
import {
  createSelfReportedState,
  loadStateCheckResult,
  saveStateCheckResult,
} from "@/utils/stateCheckStorage";
import { HELPER_CLASS, PANEL_CLASS, PRIMARY_BUTTON_CLASS } from "@/utils/ui";

type StateCheckFormProps = {
  context: StateCheckContext;
};

/**
 * Formats the update time for display.
 * @param updatedAt The timestamp of the last update
 * @returns A formatted date and time string
 */
const formatUpdateTime = (updatedAt: string) =>
  // Convert the timestamp to a Date object and format it according to the "en-AU" locale.
  new Intl.DateTimeFormat("en-AU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(updatedAt));

/**
 * Renders a form for the user to select their current state.
 * @param param0 The props object containing the context for the state check form
 * @returns The JSX element representing the state check form
 */
export default function StateCheckForm({ context }: StateCheckFormProps) {
  const router = useRouter();
  const [currentState, setCurrentState] = useState<SelfReportedState | null>(
    null,
  );

  // state for camera monitoring preference
  const [cameraPreference, setCameraPreference] =
    useState<CameraMonitoringPreferenceType | null>(null);

  // Load the current state from localStorage when the component mounts.
  useEffect(() => {
    // queueMicrotask defers the setState out of the effect body to satisfy
    queueMicrotask(() => {
      setCurrentState(loadStateCheckResult());
    });
  }, []);
  
  /**
   * Updates the current self-reported state based on the user's selection.
   * @param value The new self-reported state value selected by the user
   */
  function selectSelfReportedState(value: SelfReportedStateValue) {
    const newState = createSelfReportedState(value, context);

    // One localStorage key means a new selection replaces the previous one.
    saveStateCheckResult(newState);
    setCurrentState(newState);
  }

  // Callback function to update the camera monitoring preference
  const updateCameraPreference = useCallback(
    // This function will be called whenever the camera monitoring preference changes.
    (preference: CameraMonitoringPreferenceType | null) => {
      setCameraPreference(preference);
    },
    [],
  );

  /**
   * Continues to the route breaks page if both the current state and camera preference are set.
   * @returns void
   */
  function continueToRouteBreaks() {
    if (!currentState || !cameraPreference) {
      return;
    }

    router.push("/route-breaks");
  }

  return (
    <section className="flex min-h-screen flex-col gap-4 py-4 pb-8">
      <header>
        <p className="text-sm font-semibold text-muted">Driver Safety</p>
        <h1 className="text-2xl font-bold text-ink">State Check</h1>
        <p className="mt-2 text-sm text-muted">
          Select the option that best describes how sleepy you feel now.
        </p>
      </header>

      <div className="grid gap-3">
        {SELF_REPORTED_STATE_OPTIONS.map((option) => {
          const isSelected = currentState?.value === option.value;

          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={isSelected}
              onClick={() => selectSelfReportedState(option.value)}
              className={`rounded-xl border px-4 py-3 text-left font-semibold transition ${
                isSelected
                  ? "border-brand bg-brand-tint text-brand-strong"
                  : "border-line-strong bg-surface text-ink hover:bg-surface-alt active:bg-brand-tint"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      {currentState && (
        <div className={`${PANEL_CLASS} text-sm text-muted`}>
          <p>
            Current state:{" "}
            <span className="font-semibold text-ink">{currentState.label}</span>
          </p>
          <p>Source: {currentState.source}</p>
          <p>Updated: {formatUpdateTime(currentState.updatedAt)}</p>
        </div>
      )}

      <CameraMonitoringPreference
        stateCheckCompleted={currentState !== null}
        onPreferenceChange={updateCameraPreference}
      />

      <button
        type="button"
        disabled={!currentState || !cameraPreference}
        onClick={continueToRouteBreaks}
        className={PRIMARY_BUTTON_CLASS}
      >
        Continue to Route & Breaks
      </button>

      {currentState && !cameraPreference && (
        <p className={HELPER_CLASS}>
          Choose whether to enable camera monitoring before continuing.
        </p>
      )}
    </section>
  );
}
