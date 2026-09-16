"use client";

import { useEffect, useRef, useState } from "react";
import { loadCameraMonitoringPreference } from "@/utils/cameraMonitoringStorage";
import {
  attachCameraStreamToVideo,
  startCameraMonitoringSession,
} from "@/utils/cameraMonitoringSession";
import {
  analyzeEyeClosure,
  EYE_CLOSED_WARNING_MS,
} from "@/utils/fatigueDetection";

type CameraMonitoringPreviewProps = {
  onDrowsinessWarning?: () => void;
};

/**
 * A React component that displays a live preview of the camera monitoring feed and detects drowsiness based on eye closure.
 * @param param0 An object containing the onDrowsinessWarning callback function.
 * @returns A React component for previewing the camera monitoring feed and detecting drowsiness.
 */
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
    let cancelled = false; // Flag to indicate if the component has been unmounted or the effect has been cancelled.
    const videoElement = videoRef.current;

    async function attachPreview() {
      const preference = loadCameraMonitoringPreference();

      if (!preference?.enabled) {
        setStatus("inactive");
        return;
      }

      try {
        // Start the camera monitoring session and obtain the active stream and face landmarker.
        const session = await startCameraMonitoringSession(); 

        if (cancelled) {
          return;
        }
        
        // Attach the active camera stream to the video element for preview.
        attachCameraStreamToVideo(videoElement, session.stream);
        setStatus("active");
        
        // Begin the frame detection loop for drowsiness analysis.
        const detectFrame = () => {
          // Skip this frame if the video element is not ready.
          if (!videoElement || videoElement.readyState < 2) {
            animationFrameRef.current =
              window.requestAnimationFrame(detectFrame); // call detectFrame 
            return;
          }
          
          // Perform face landmark detection on the current video frame.
          const result = session.faceLandmarker.detectForVideo(
            videoElement,
            performance.now(),
          );

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
    
    // Cleanup function to stop the camera stream and cancel the animation frame when the component unmounts.
    return () => {
      cancelled = true;
      if (animationFrameRef.current) {
        // Cancel the ongoing animation frame to stop face detection.
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
