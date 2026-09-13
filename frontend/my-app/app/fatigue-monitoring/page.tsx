"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle,
  Users,
  X,
} from "lucide-react";
import { FaceLandmarker } from "@mediapipe/tasks-vision";

import { createFaceLandmarker } from "@/utils/createFaceLandmarker";
import {
  analyzeEyeClosure,
  EYE_CLOSED_WARNING_MS,
} from "@/utils/fatigueDetection";
import { JourneyDetails } from "@/types/journeyDetails";
import {
  AFTER_REST_RESULT_STORAGE_KEY,
  AfterRestResult,
} from "@/types/afterRestCheck";
import {
  REST_STATUS_STORAGE_KEY,
  RestStatusRecord,
} from "@/types/restStatus";
import {
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
} from "@/utils/ui";
import { useVoiceAlert } from "@/hooks/useVoiceAlert";

const CURRENT_JOURNEY_STORAGE_KEY = "currentJourneyDetails";

function readJourneyDetails(): JourneyDetails | null {
  try {
    const raw = localStorage.getItem(CURRENT_JOURNEY_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as JourneyDetails) : null;
  } catch {
    return null;
  }
}

function readRestStatus(): RestStatusRecord | null {
  try {
    const raw = localStorage.getItem(REST_STATUS_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as RestStatusRecord) : null;
;
  } catch {
    return null;
  }
}

function readAfterRestResult(): AfterRestResult | null {
  try {
    const raw = localStorage.getItem(AFTER_REST_RESULT_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as AfterRestResult) : null;
  } catch {
    return null;
  }
}

export default function FatigueMonitoringPage() {
  const router = useRouter();

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const faceLandmarkerRef = useRef<FaceLandmarker | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const eyeClosedStartTimeRef = useRef<number | null>(null);

  const [isAfterRestCheck, setIsAfterRestCheck] = useState(false);
  const [journeyDetails, setJourneyDetails] =
    useState<JourneyDetails | null>(null);
  const [afterRestResult, setAfterRestResult] =
    useState<AfterRestResult | null>(null);
  const [isHandoverOpen, setIsHandoverOpen] = useState(false);
  const [actionError, setActionError] = useState("");

  const [status, setStatus] = useState("Camera off");
  const [modelStatus, setModelStatus] = useState("Model not loaded");
  const [eyeStatus, setEyeStatus] = useState("No eye analysis yet");
  const [drowsinessStatus, setDrowsinessStatus] = useState("No warning");
  const [faceStatus, setFaceStatus] = useState("No analysis yet");
  const [fatigueAlertKey, setFatigueAlertKey] =
    useState<string | null>(null);
  const [
    dismissedFatigueAlertKey,
    setDismissedFatigueAlertKey,
  ] = useState<string | null>(null);

  const displayedFatigueWarning =
    fatigueAlertKey !== null &&
    fatigueAlertKey !== dismissedFatigueAlertKey;

  const {
    status: fatigueVoiceStatus,
    play: playFatigueVoice,
    stop: stopFatigueVoice,
  } = useVoiceAlert({
    alertKey: displayedFatigueWarning
      ? fatigueAlertKey
      : null,
    message: displayedFatigueWarning
      ? "Fatigue warning. Your eyes have been closed for too long. Stop only when and where it is legal and safe, and arrange rest now."
      : null,
  });

  function dismissFatigueWarning() {
    if (!fatigueAlertKey) {
      return;
    }

    setDismissedFatigueAlertKey(fatigueAlertKey);
    stopFatigueVoice();
  }

  useEffect(() => {
    queueMicrotask(() => {
      const mode = new URLSearchParams(window.location.search).get("mode");
      const afterRestMode = mode === "after-rest";

      setIsAfterRestCheck(afterRestMode);
      setJourneyDetails(readJourneyDetails());

      if (afterRestMode) {
        const restStatus = readRestStatus();
        const storedResult = readAfterRestResult();

        if (
          storedResult &&
          storedResult.restEndedAt === restStatus?.restEndedAt
        ) {
          setAfterRestResult(storedResult);
        }
      }
    });
  }, []);

  function stopCamera() {
    if (animationFrameRef.current) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setStatus("Camera off");
  }

  function saveAfterRestResult(result: AfterRestResult) {
    localStorage.setItem(
      AFTER_REST_RESULT_STORAGE_KEY,
      JSON.stringify(result),
    );

    setAfterRestResult(result);
    setIsHandoverOpen(false);
    setActionError("");
  }

  function completeSelfReport(persistentSleepiness: boolean) {
    stopCamera();
    stopFatigueVoice();
    setDrowsinessStatus("No warning");
    setFatigueAlertKey(null);
    setDismissedFatigueAlertKey(null);

    const restStatus = readRestStatus();

    const result: AfterRestResult = {
      method: "self-report",
      writtenState: persistentSleepiness
        ? "Driver reports that sleepiness remains after rest."
        : "Driver reports no current sleepiness after rest.",
      persistentSleepiness,
      completedAt: new Date().toISOString(),
      restEndedAt: restStatus?.restEndedAt ?? null,
    };

    try {
      saveAfterRestResult(result);
    } catch {
      setActionError(
        "The after-rest result could not be recorded. Please try again.",
      );
    }
  }

  function continueResting() {
    const restStatus = readRestStatus();

    if (!restStatus) {
      setActionError(
        "The rest record is unavailable. Continued rest could not be recorded.",
      );
      return;
    }

    const continuedRest: RestStatusRecord = {
      ...restStatus,
      status: "resting",
      restStartedAt: new Date().toISOString(),
      restEndedAt: null,
    };

    try {
      localStorage.setItem(
        REST_STATUS_STORAGE_KEY,
        JSON.stringify(continuedRest),
      );

      router.push("/navigate");
    } catch {
      setActionError(
        "Continued rest could not be recorded. Please try again.",
      );
    }
  }

  function continueNavigation() {
    try {
      localStorage.removeItem(REST_STATUS_STORAGE_KEY);
      router.push("/route-breaks");
    } catch {
      setActionError(
        "Navigation could not be reopened. Please try again.",
      );
    }
  }

  const startDetectionLoop = () => {
    if (animationFrameRef.current) {
      return;
    }

    const detectFrame = () => {
      if (!videoRef.current || !faceLandmarkerRef.current) {
        setFaceStatus("Camera or model is not ready");
        animationFrameRef.current = null;
        return;
      }

      if (videoRef.current.readyState < 2) {
        setFaceStatus("Video is not ready yet");
        animationFrameRef.current =
          window.requestAnimationFrame(detectFrame);
        return;
      }

      const result = faceLandmarkerRef.current.detectForVideo(
        videoRef.current,
        performance.now(),
      );

      if (result.faceLandmarks.length === 0) {
        setFaceStatus("No face detected");
        setEyeStatus("No eye analysis available");
        eyeClosedStartTimeRef.current = null;
        setDrowsinessStatus("No face detected");
        setFatigueAlertKey(null);
      } else {
        const landmarks = result.faceLandmarks[0];
        const { averageEar, eyesAreClosed } =
          analyzeEyeClosure(landmarks);

        const currentTime = performance.now();

        if (eyesAreClosed) {
          if (eyeClosedStartTimeRef.current === null) {
            eyeClosedStartTimeRef.current = currentTime;
          }

          const closedDuration =
            currentTime - eyeClosedStartTimeRef.current;

          if (closedDuration >= EYE_CLOSED_WARNING_MS) {
            setDrowsinessStatus(
              "Warning: eyes closed for too long",
            );

            setFatigueAlertKey(
              (currentKey) =>
                currentKey ?? `eyes-closed-${Date.now()}`,
            );
          } else {
            setDrowsinessStatus(
              `Eyes closed for ${(closedDuration / 1000).toFixed(1)}s`,
            );
          }
        } else {
          eyeClosedStartTimeRef.current = null;
          setDrowsinessStatus("No warning");
          setFatigueAlertKey(null);
        }

        setFaceStatus(
          `Face detected: ${landmarks.length} landmarks`,
        );

        setEyeStatus(
          `EAR: ${averageEar.toFixed(3)} - Eyes ${
            eyesAreClosed ? "closed" : "open"
          }`,
        );
      }

      animationFrameRef.current =
        window.requestAnimationFrame(detectFrame);
    };

    detectFrame();
  };

  const loadFaceLandmarker = async () => {
    setModelStatus("Loading model...");

    try {
      faceLandmarkerRef.current = await createFaceLandmarker();
      setModelStatus("Model loaded successfully");
    } catch (error) {
      setModelStatus("Failed to load model");
      console.error(error);
    }
  };

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false,
      });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }

      setStatus("Camera active");
    } catch {
      setStatus("Could not access camera");
    }
  };

  return (
    <main className="container mx-auto max-w-2xl px-4 py-6">
      <h1 className="text-2xl font-bold text-ink">
        {isAfterRestCheck
          ? "After-rest Check"
          : "Fatigue Monitoring"}
      </h1>

      {isAfterRestCheck && !afterRestResult && (
        <section className="mt-4 rounded-xl border border-line bg-surface px-4 py-4">
          <h2 className="font-bold text-ink">
            How do you feel after resting?
          </h2>

          <p className="mt-1 text-sm text-muted">
            Select the option that best describes your current state.
          </p>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => completeSelfReport(true)}
              className={SECONDARY_BUTTON_CLASS}
            >
              I still feel sleepy
            </button>

            <button
              type="button"
              onClick={() => completeSelfReport(false)}
              className={SECONDARY_BUTTON_CLASS}
            >
              I do not feel sleepy right now
            </button>
          </div>
        </section>
      )}

      {isAfterRestCheck &&
        afterRestResult?.persistentSleepiness && (
          <section
            aria-live="polite"
            className="mt-4 rounded-xl border border-danger-line bg-danger-tint px-4 py-4 text-danger"
          >
            <div className="flex items-start gap-3">
              <AlertTriangle
                className="mt-0.5 h-6 w-6 shrink-0"
                aria-hidden
              />

              <div>
                <h2 className="text-lg font-bold">
                  Continue resting
                </h2>

                <p className="mt-2 text-sm">
                  Sleepiness is still reported. Completing a break or
                  completing this check does not mean that recovery has
                  occurred.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={continueResting}
              className={`${PRIMARY_BUTTON_CLASS} mt-4 w-full`}
            >
              Continue Resting
            </button>

            {journeyDetails?.hasCoDriver && (
              <button
                type="button"
                onClick={() => setIsHandoverOpen(true)}
                className={`${SECONDARY_BUTTON_CLASS} mt-3 w-full`}
              >
                <Users className="h-4 w-4" aria-hidden />
                Review Co-driver Handover
              </button>
            )}

            {isHandoverOpen && journeyDetails?.hasCoDriver && (
              <div className="mt-4 rounded-lg border border-danger-line bg-surface px-3 py-3 text-ink">
                <h3 className="font-bold">
                  Co-driver handover
                </h3>

                <p className="mt-2 text-sm text-muted">
                  Ask the registered co-driver to confirm that they are
                  alert, willing, and able to take over. RouteRest has
                  not confirmed that the co-driver is ready to drive.
                </p>
              </div>
            )}
          </section>
        )}

      {isAfterRestCheck &&
        afterRestResult &&
        !afterRestResult.persistentSleepiness && (
          <section
            aria-live="polite"
            className="mt-4 rounded-xl border border-brand bg-surface px-4 py-4"
          >
            <div className="flex items-start gap-3">
              <CheckCircle
                className="mt-0.5 h-6 w-6 shrink-0 text-brand-strong"
                aria-hidden
              />

              <div>
                <h2 className="text-lg font-bold text-ink">
                  Continue-navigation option available
                </h2>

                <p className="mt-2 text-sm text-muted">
                  This result did not trigger persistent-sleepiness
                  guidance. It does not confirm that driving is safe.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={continueNavigation}
              className={`${PRIMARY_BUTTON_CLASS} mt-4 w-full`}
            >
              Continue Navigation
            </button>
          </section>
        )}

      {actionError && (
        <p
          role="alert"
          className="mt-4 rounded-lg border border-danger-line bg-danger-tint px-3 py-3 text-sm font-semibold text-danger"
        >
          {actionError}
        </p>
      )}

      <section className="mt-6 rounded-xl border border-line bg-surface px-4 py-4">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="w-full max-w-md rounded-lg bg-black"
        />

        <p className="mt-2 text-sm text-muted">{status}</p>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={startCamera}
            className={SECONDARY_BUTTON_CLASS}
          >
            Camera ON
          </button>

          <button
            type="button"
            onClick={stopCamera}
            className={SECONDARY_BUTTON_CLASS}
          >
            Camera OFF
          </button>

          <button
            type="button"
            onClick={loadFaceLandmarker}
            className={SECONDARY_BUTTON_CLASS}
          >
            Load Face Model
          </button>
        </div>

        <p className="mt-2 text-sm text-muted">{modelStatus}</p>

        <button
          type="button"
          onClick={startDetectionLoop}
          className={`${PRIMARY_BUTTON_CLASS} mt-3`}
        >
          Start Live Detection
        </button>

        <div className="mt-3 space-y-1 text-sm text-muted">
          <p>{faceStatus}</p>
          <p>{eyeStatus}</p>
          <p>{drowsinessStatus}</p>
        </div>

        {displayedFatigueWarning && (
          <div
            role="alert"
            aria-live="assertive"
            className="mt-4 rounded-xl border border-danger-line bg-danger-tint px-4 py-4 text-danger"
          >
            <div className="flex items-start gap-3">
              <AlertTriangle
                className="mt-0.5 h-6 w-6 shrink-0"
                aria-hidden
              />

              <div className="min-w-0 flex-1">
                <h2 className="font-bold">
                  Fatigue warning
                </h2>

                <p className="mt-1 text-sm">
                  Your eyes have been closed for too long. Stop only when
                  and where it is legal and safe, and arrange rest now.
                </p>
              </div>

              <button
                type="button"
                aria-label="Dismiss this fatigue warning"
                onClick={dismissFatigueWarning}
                className="shrink-0 rounded-lg p-2 text-danger hover:bg-surface"
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>

            <button
              type="button"
              onClick={() => router.push("/navigate")}
              className={`${PRIMARY_BUTTON_CLASS} mt-4 w-full`}
            >
              Open Rest Actions
            </button>

            <button
              type="button"
              onClick={playFatigueVoice}
              className={`${SECONDARY_BUTTON_CLASS} mt-2 w-full`}
            >
              Play Voice Warning
            </button>

            {fatigueVoiceStatus === "playing" && (
              <p className="mt-2 text-sm">
                Voice warning is playing.
              </p>
            )}

            {fatigueVoiceStatus === "played" && (
              <p className="mt-2 text-sm">
                Voice warning finished.
              </p>
            )}

            {(fatigueVoiceStatus === "unavailable" ||
              fatigueVoiceStatus === "failed") && (
              <p className="mt-2 text-sm">
                Voice playback is unavailable. Follow the text warning
                and rest action above.
              </p>
            )}
          </div>
        )}
      </section>
    </main>
  );
}