"use client";

import { useEffect, useState } from "react";
import CameraMonitoringPreference from "@/components/CameraMonitoringPreference";
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
  const [currentState, setCurrentState] = useState<SelfReportedState | null>(
    null,
  );

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

      <CameraMonitoringPreference stateCheckCompleted={currentState !== null} />
    </section>
  );
}
