"use client";

import { useEffect, useRef, useState } from "react";
import { loadCameraMonitoringPreference } from "@/utils/cameraMonitoringStorage";
import {
  attachCameraStreamToVideo,
  startCameraMonitoringSession,
} from "@/utils/cameraMonitoringSession";

export default function CameraMonitoringPreview() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
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
      } catch {
        setStatus("unavailable");
      }
    }

    attachPreview();

    return () => {
      cancelled = true;
      attachCameraStreamToVideo(videoElement, null);
    };
  }, []);

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
