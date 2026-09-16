"use client";

import { useEffect, useRef, useState } from "react";
import { loadCameraMonitoringPreference } from "@/utils/cameraMonitoringStorage";
import {
  attachCameraStreamToVideo,
  nextVideoTimestamp,
  startCameraMonitoringSession,
} from "@/utils/cameraMonitoringSession";
import {
  analyzeEyeClosure,
  EYE_CLOSED_WARNING_MS,
} from "@/utils/fatigueDetection";

type CameraMonitoringPreviewProps = {
  onDrowsinessWarning?: () => void;
};

export default function CameraMonitoringPreview({
  onDrowsinessWarning,
}: CameraMonitoringPreviewProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const eyeClosedStartTimeRef = useRef<number | null>(null);
  const warningShownForCurrentClosureRef = useRef(false);
  const [status, setStatus] = useState<
    "loading" | "inactive" | "active" | "unavailable"
  >("loading");

  useEffect(() => {
    let cancelled = false;
    const videoElement = videoRef.current;

    async function attachPreview() {
      const preference = loadCameraMonitoringPreference();

      if (!preference?.enabled) {
        setStatus("inactive");
        return;
      }

      try {
        const session = await startCameraMonitoringSession();

        if (cancelled) {
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
        setStatus("unavailable");
      }
    }

    attachPreview();

    return () => {
      cancelled = true;
      if (animationFrameRef.current) {
        window.cancelAnimationFrame(animationFrameRef.current);
      }
      attachCameraStreamToVideo(videoElement, null);
    };
  }, [onDrowsinessWarning]);

  if (status === "inactive") {
    return (
      <div className="rounded-xl border border-line bg-surface px-3 py-2 text-sm text-muted">
        Live camera monitoring is inactive.
      </div>
    );
  }

  if (status === "unavailable") {
    return (
      <div className="rounded-xl border border-danger-line bg-danger-tint px-3 py-2 text-sm text-danger">
        Camera monitoring could not continue on this page.
      </div>
    );
  }

  return (
    <section className="rounded-xl border border-line bg-surface px-3 py-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold">Camera Monitoring</h2>
        <span className="text-xs font-semibold text-brand-strong">
          {status === "active" ? "Active" : "Starting"}
        </span>
      </div>
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className="h-80 w-full rounded-lg bg-black object-cover"
      />
    </section>
  );
}
