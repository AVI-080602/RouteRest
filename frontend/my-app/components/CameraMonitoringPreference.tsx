"use client";

import { useEffect, useRef, useState } from "react";
import {
  CameraMonitoringPreference as CameraMonitoringPreferenceType,
  CameraMonitoringStatus,
} from "@/types/cameraMonitoring";
import {
  createCameraMonitoringPreference,
  loadCameraMonitoringPreference,
  saveCameraMonitoringPreference,
} from "@/utils/cameraMonitoringStorage";
import {
  attachCameraStreamToVideo,
  getActiveCameraMonitoringStream,
  startCameraMonitoringSession,
  stopCameraMonitoringSession,
} from "@/utils/cameraMonitoringSession";
import { HELPER_CLASS, PRIMARY_BUTTON_CLASS } from "@/utils/ui";

type CameraMonitoringPreferenceProps = {
  stateCheckCompleted: boolean;
  onPreferenceChange?: (
    preference: CameraMonitoringPreferenceType | null,
  ) => void;
};

/**
 * Formats the provided timestamp string into a human-readable date and time string.
 * @param updatedAt The timestamp string representing the last update time.
 * @returns A formatted date and time string based on the provided timestamp.
 */
const formatUpdateTime = (updatedAt: string) =>
  new Intl.DateTimeFormat("en-AU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(updatedAt));

/**
 * A React component for managing camera monitoring preferences.
 * @param param0 An object containing the stateCheckCompleted boolean.
 * @returns A React component for managing camera monitoring preferences.
 */
export default function CameraMonitoringPreference({
  stateCheckCompleted,
  onPreferenceChange,
}: CameraMonitoringPreferenceProps) {
  const [preference, setPreference] =
    useState<CameraMonitoringPreferenceType | null>(null);
  const [status, setStatus] = useState<CameraMonitoringStatus>("not_selected");
  const [previewVisible, setPreviewVisible] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Load the saved camera monitoring preference from localStorage when the component mounts.
  useEffect(() => {
    queueMicrotask(() => {
      const savedPreference = loadCameraMonitoringPreference();

      setPreference(savedPreference);
      onPreferenceChange?.(savedPreference); // Notify the parent component of the loaded preference
      setStatus(savedPreference?.enabled ? "active" : "inactive");

      const activeStream = getActiveCameraMonitoringStream(); // Get the currently active camera monitoring stream, if any.
      if (savedPreference?.enabled && activeStream) {
        attachCameraStreamToVideo(videoRef.current, activeStream);
        setPreviewVisible(true);
      }
    });
  }, [onPreferenceChange]); 

  useEffect(() => {
    if (!previewVisible) {
      attachCameraStreamToVideo(videoRef.current, null);
      return;
    }

    attachCameraStreamToVideo(
      videoRef.current,
      getActiveCameraMonitoringStream(),
    );
  }, [previewVisible]);

  /**
   * Starts the camera monitoring session if the state check is completed.
   * @returns A promise that resolves when the camera monitoring session has been successfully started, or returns early if the state check is not completed.
   */
  async function enableCameraMonitoring() {
    if (!stateCheckCompleted) {
      return;
    }

    setStatus("starting");

    try {
      const session = await startCameraMonitoringSession(); // Start the camera monitoring session and obtain the active stream and face landmarker.

      const enabledPreference = createCameraMonitoringPreference(true);

      saveCameraMonitoringPreference(enabledPreference);
      setPreference(enabledPreference);
      onPreferenceChange?.(enabledPreference);
      attachCameraStreamToVideo(videoRef.current, session.stream);
      setPreviewVisible(true);
      setStatus("active");
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotAllowedError") {
        setStatus("permission_denied");
        return;
      }
      setStatus("model_error");
    }
  }

  /**
   * Keeps the camera monitoring off by updating the preference, stopping the session, and updating the UI.
   * @returns void
   */
  function keepCameraMonitoringOff() {
    if (!stateCheckCompleted) {
      return;
    }

    const disabledPreference = createCameraMonitoringPreference(false);

    saveCameraMonitoringPreference(disabledPreference);
    setPreference(disabledPreference);
    onPreferenceChange?.(disabledPreference); // Notify the parent component of the updated preference
    stopCameraMonitoringSession();
    attachCameraStreamToVideo(videoRef.current, null);
    setPreviewVisible(false);
    setStatus("inactive");
  }

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-line bg-surface px-4 py-4">
      <div>
        <h2 className="text-lg font-bold text-ink">Camera Monitoring</h2>
        <p className="mt-1 text-sm text-muted">
          Optional live monitoring can start during navigation after your State
          Check is complete.
        </p>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          disabled={!stateCheckCompleted || status === "starting"}
          onClick={enableCameraMonitoring}
          className={PRIMARY_BUTTON_CLASS}
        >
          {status === "starting" ? "Starting..." : "Enable Monitoring"}
        </button>

        <button
          type="button"
          disabled={!stateCheckCompleted || status === "starting"}
          onClick={keepCameraMonitoringOff}
          className="inline-flex h-12 w-full items-center justify-center rounded-xl border border-line-strong bg-surface px-4 font-semibold text-ink transition hover:bg-surface-alt active:bg-brand-tint disabled:cursor-not-allowed disabled:opacity-60"
        >
          Keep Off
        </button>
      </div>

      {!stateCheckCompleted && (
        <p className="text-sm text-muted">
          Complete your State Check before choosing camera monitoring.
        </p>
      )}

      {status === "active" && preference?.enabled && (
        <p className="text-sm font-semibold text-brand-strong">
          Camera monitoring is active. The preview will stay available when you
          continue.
        </p>
      )}

      {previewVisible && (
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className="h-72 w-full rounded-xl bg-black object-cover sm:h-96"
        />
      )}

      {status === "inactive" && preference && !preference.enabled && (
        <p className="text-sm text-muted">
          Live camera monitoring is inactive. Your completed State Check will
          still be used.
        </p>
      )}

      {status === "permission_denied" && (
        <p className="text-sm text-danger">
          Camera permission was not available. You can keep monitoring off and
          continue with your completed State Check.
        </p>
      )}

      {status === "model_error" && (
        <p className="text-sm text-danger">
          Camera monitoring could not start. Check the camera and model setup,
          or keep monitoring off.
        </p>
      )}

      {preference && (
        <p className={HELPER_CLASS}>
          Preference updated: {formatUpdateTime(preference.updatedAt)}
        </p>
      )}
    </section>
  );
}
