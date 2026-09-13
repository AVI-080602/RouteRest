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
    // use queueMicrotask to avoid casading render
    queueMicrotask(() => {
      setCurrentState(loadStateCheckResult());
    });
  }, []);

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

  function continueToRouteBreaks() {
    if (!currentState || !cameraPreference) {
      return;
    }

    router.push("/route-breaks");
  }

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold">State Check</h1>
        <p className="mt-2 text-sm text-slate-400">
          Select the option that best describes how sleepy you feel now.
        </p>
      </div>

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
                  ? "border-yellow-500 bg-yellow-500 text-black"
                  : "border-slate-700 bg-slate-900 text-white active:bg-slate-800"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      {currentState && (
        <div className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-slate-300">
          <p>
            Current state:{" "}
            <span className="font-semibold text-white">
              {currentState.label}
            </span>
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
        className="rounded-xl bg-yellow-500 px-4 py-3 font-bold text-black transition active:bg-yellow-600 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
      >
        Continue to Route & Breaks
      </button>

      {currentState && !cameraPreference && (
        <p className="text-sm text-slate-400">
          Choose whether to enable camera monitoring before continuing.
        </p>
      )}
    </section>
  );
}
