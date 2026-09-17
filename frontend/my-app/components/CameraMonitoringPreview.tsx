"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createCameraMonitoringPreference,
  loadCameraMonitoringPreference,
  saveCameraMonitoringPreference,
} from "@/utils/cameraMonitoringStorage";
import {
  attachCameraStreamToVideo,
  nextVideoTimestamp,
  startCameraMonitoringSession,
  stopCameraMonitoringSession,
} from "@/utils/cameraMonitoringSession";
import {
  analyzeEyeClosure,
  EYE_CLOSED_WARNING_MS,
} from "@/utils/fatigueDetection";

type CameraMonitoringPreviewProps = {
  className?: string;
  onStatusChange?: (
    status: "loading" | "inactive" | "active" | "unavailable",
  ) => void;
  onDrowsinessWarning?: () => void;
};

export default function CameraMonitoringPreview({
  className = "",
  onStatusChange,
  onDrowsinessWarning,
}: CameraMonitoringPreviewProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const eyeClosedStartTimeRef = useRef<number | null>(null);
  const warningShownForCurrentClosureRef = useRef(false);
  const [status, setStatus] = useState<
    "loading" | "inactive" | "active" | "unavailable"
  >("loading");
  const [sessionVersion, setSessionVersion] = useState(0);

  useEffect(() => {
    onStatusChange?.(status);
  }, [onStatusChange, status]);

  const cancelDetectionLoop = useCallback(() => {
    if (animationFrameRef.current) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
  }, []);

  function turnCameraOn() {
    const enabledPreference = createCameraMonitoringPreference(true);

    saveCameraMonitoringPreference(enabledPreference);
    setStatus("loading");
    setSessionVersion((version) => version + 1);
  }

  function turnCameraOff() {
    const disabledPreference = createCameraMonitoringPreference(false);

    saveCameraMonitoringPreference(disabledPreference);
    setSessionVersion((version) => version + 1);
    cancelDetectionLoop();
    stopCameraMonitoringSession();
    attachCameraStreamToVideo(videoRef.current, null);
    eyeClosedStartTimeRef.current = null;
    warningShownForCurrentClosureRef.current = false;
    setStatus("inactive");
  }

  useEffect(() => {
    let cancelled = false;
    const videoElement = videoRef.current;

    async function attachPreview() {
      const preference = loadCameraMonitoringPreference();

      if (!preference?.enabled) {
        stopCameraMonitoringSession();
        attachCameraStreamToVideo(videoElement, null);
        setStatus("inactive");
        return;
      }

      try {
        const session = await startCameraMonitoringSession();

        if (cancelled) {
          return;
        }

        if (!loadCameraMonitoringPreference()?.enabled) {
          stopCameraMonitoringSession();
          attachCameraStreamToVideo(videoElement, null);
          return;
        }

        attachCameraStreamToVideo(videoElement, session.stream);
        setStatus("active");

        const detectFrame = () => {
          // The effect that started this loop may already have been
          // cleaned up, for example because the driver moved to another
          // page. Without this the loop kept running against a detached
          // video, and a second loop would start alongside it.
          if (cancelled) {
            return;
          }

          if (
            !videoElement ||
            videoElement.readyState < 2 ||
            // A frame with no size yet makes the detector throw rather
            // than simply returning no faces.
            videoElement.videoWidth === 0 ||
            videoElement.videoHeight === 0
          ) {
            animationFrameRef.current =
              window.requestAnimationFrame(detectFrame);
            return;
          }

          let result;
          try {
            result = session.faceLandmarker.detectForVideo(
              videoElement,
              // Shared counter, so overlapping loops cannot send the
              // detector a timestamp that goes backwards.
              nextVideoTimestamp(),
            );
          } catch {
            // Detection has failed rather than found nothing. Stop the
            // loop and say so, instead of repeating the same error on
            // every frame and leaving a preview that looks like it is
            // still watching the driver.
            cancelDetectionLoop();
            stopCameraMonitoringSession();
            attachCameraStreamToVideo(videoElement, null);
            setStatus("unavailable");
            return;
          }

          if (result.faceLandmarks.length === 0) {
            eyeClosedStartTimeRef.current = null;
            warningShownForCurrentClosureRef.current = false;
          } else {
            const { eyesAreClosed } = analyzeEyeClosure(
              result.faceLandmarks[0],
            );
            const currentTime = performance.now();

            if (eyesAreClosed) {
              eyeClosedStartTimeRef.current ??= currentTime;

              const closedDuration =
                currentTime - eyeClosedStartTimeRef.current;

              if (
                closedDuration >= EYE_CLOSED_WARNING_MS &&
                !warningShownForCurrentClosureRef.current
              ) {
                warningShownForCurrentClosureRef.current = true;
                onDrowsinessWarning?.();
              }
            } else {
              eyeClosedStartTimeRef.current = null;
              warningShownForCurrentClosureRef.current = false;
            }
          }

          animationFrameRef.current = window.requestAnimationFrame(detectFrame);
        };

        detectFrame();
      } catch {
        if (!cancelled) {
          stopCameraMonitoringSession();
          attachCameraStreamToVideo(videoElement, null);
          setStatus("unavailable");
        }
      }
    }

    attachPreview();

    return () => {
      cancelled = true;
      cancelDetectionLoop();
      attachCameraStreamToVideo(videoElement, null);
    };
  }, [cancelDetectionLoop, onDrowsinessWarning, sessionVersion]);

  if (status === "inactive") {
    return (
      <section
        className={`rounded-xl border border-line bg-surface px-3 py-3 ${className}`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-ink">Camera Monitoring</h2>
            <p className="text-sm text-muted">Camera Off</p>
          </div>
          <button
            type="button"
            onClick={turnCameraOn}
            className="inline-flex items-center justify-center rounded-lg border border-brand px-3 py-1.5 text-xs font-semibold text-brand transition hover:bg-brand-tint"
          >
            Turn Camera On
          </button>
        </div>
      </section>
    );
  }

  if (status === "unavailable") {
    return (
      <section
        className={`rounded-xl border border-danger-line bg-danger-tint px-3 py-3 ${className}`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-danger">Camera Monitoring</h2>
            <p className="text-sm text-danger">
              Monitoring Unavailable. Check camera permission or lighting.
            </p>
          </div>
          <button
            type="button"
            onClick={turnCameraOn}
            className="inline-flex items-center justify-center rounded-lg border border-danger-line px-3 py-1.5 text-xs font-semibold text-danger transition hover:bg-surface"
          >
            Try Again
          </button>
        </div>
      </section>
    );
  }

  return (
    <section
      className={`flex flex-col rounded-xl border border-line bg-surface px-3 py-3 ${className}`}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold">Camera Monitoring</h2>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-brand-strong">
            {status === "active" ? "Active" : "Starting"}
          </span>
          <button
            type="button"
            onClick={turnCameraOff}
            className="inline-flex items-center justify-center rounded-lg border border-line-strong px-3 py-1.5 text-xs font-semibold text-muted transition hover:bg-surface-alt"
          >
            Turn Camera Off
          </button>
        </div>
      </div>
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className="h-44 w-full rounded-lg bg-black object-contain"
      />
    </section>
  );
}
