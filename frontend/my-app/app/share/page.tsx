"use client";

import { Link } from "@/utils/appNavigation";
import { useRouter } from "@/utils/appNavigation";
import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Camera, QrCode, ScanLine } from "lucide-react";
import Disclaimer from "@/components/Disclaimer";
import { JourneyDetails, RestBreak } from "@/types/journeyDetails";
import {
  NAVIGATION_PLAN_STORAGE_KEY,
  NAVIGATION_PROGRESS_STORAGE_KEY,
} from "@/types/navigation";
import {
  SHARE_LINK_PARAM,
  decodeSharedJourneyText,
  describeJourney,
  encodeJourneyToShareUrl,
} from "@/utils/journeyTransfer";
import {
  GHOST_BUTTON_CLASS,
  HELPER_CLASS,
  INPUT_CLASS,
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
} from "@/utils/ui";

/**
 * US 1.4: continue the same journey on another phone.
 *
 * One phone shows a QR code of its journey, the other scans it. Nothing
 * goes through our server, which is the whole point: the Data Management
 * Plan forbids storing a driver's journey anywhere but their own device.
 *
 * The code carries the journey only. The receiving phone asks the backend
 * to rebuild the rest plan, so the plan always matches the rules that
 * backend has today rather than whatever the other phone calculated
 * earlier.
 */

const LOCAL_STORAGE_KEY = "currentJourneyDetails";
const REST_PLAN_STORAGE_KEY = "currentRestPlan";
const STOP_OVERRIDES_STORAGE_KEY = "currentStopOverrides";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// Eight frames a second is more than enough to catch a code the driver is
// holding still, and it keeps the phone from heating up.
const SCAN_INTERVAL_MS = 125;

type Mode = "show" | "scan";

export default function SharePage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("show");

  // ---------------- Showing this phone's journey ----------------
  const [journey, setJourney] = useState<JourneyDetails | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [showError, setShowError] = useState("");
  const [isLoaded, setIsLoaded] = useState(false);

  // Read the saved journey after the browser has taken over, so the
  // server render and the first browser render match.
  useEffect(() => {
    queueMicrotask(() => {
      try {
        const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
        setJourney(raw ? (JSON.parse(raw) as JourneyDetails) : null);
      } catch {
        setJourney(null);
      }
      setIsLoaded(true);
    });
  }, []);

  // Draw the QR code whenever the journey changes. The QR library is
  // loaded on demand so it is not part of the first page download.
  useEffect(() => {
    if (!journey) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        // A link, so an ordinary phone camera can open it directly.
        const text = encodeJourneyToShareUrl(journey, window.location.origin);
        const QRCode = (await import("qrcode")).default;
        const url = await QRCode.toDataURL(text, {
          // A screen is a clean surface, so the lowest correction level
          // is enough for a longer journey and keeps the squares big.
          // Short journeys keep the safer level.
          errorCorrectionLevel: text.length > 400 ? "L" : "M",
          // Fixed pixels per square rather than a fixed image width, so a
          // journey with more stops produces a bigger image instead of
          // finer squares. Testing with the same reader the scanner uses
          // showed a denser code stops decoding once the squares get
          // small, which is what a camera sees when held further away.
          scale: 8,
          margin: 3,
        });
        if (!cancelled) {
          setQrDataUrl(url);
          setShowError("");
        }
      } catch (error) {
        if (!cancelled) {
          setQrDataUrl("");
          setShowError(
            error instanceof Error
              ? error.message
              : "Could not build a code for this journey.",
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [journey]);

  // ---------------- Scanning another phone's journey ----------------
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState("");
  const [scanned, setScanned] = useState<JourneyDetails | null>(null);
  const [pastedCode, setPastedCode] = useState("");
  const [isImporting, setIsImporting] = useState(false);

  // A phone that is RECEIVING a journey has nothing of its own to show,
  // so the links that send a driver here to scan pass ?mode=scan and the
  // page opens on the scanning side. A code scanned with the phone's own
  // camera app arrives as a link carrying the journey itself, which is
  // read here and shown for confirmation exactly as an in-app scan is.
  // Read in an effect rather than with useSearchParams, which would put
  // this page behind a Suspense boundary for one query parameter.
  useEffect(() => {
    queueMicrotask(() => {
      const params = new URLSearchParams(window.location.search);
      if (params.get("mode") === "scan") {
        setMode("scan");
      }
      const shared = params.get(SHARE_LINK_PARAM);
      if (!shared) {
        return;
      }
      setMode("scan");
      try {
        setScanned(decodeSharedJourneyText(window.location.href));
      } catch (error) {
        setScanError(
          error instanceof Error
            ? error.message
            : "That link does not carry a journey.",
        );
      }
    });
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setIsScanning(false);
  }, []);

  // Always release the camera when leaving the page.
  useEffect(() => stopCamera, [stopCamera]);

  const startCamera = useCallback(async () => {
    setScanError("");
    setScanned(null);
    if (typeof navigator === "undefined" || !navigator.mediaDevices) {
      setScanError(
        "This browser cannot use the camera here. Paste the code text below instead.",
      );
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        // The back camera on a phone, which is the one pointed at the
        // other screen. Desktops ignore this and use their only camera.
        video: { facingMode: "environment" },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setIsScanning(true);
    } catch {
      setScanError(
        "Camera access was refused. Allow the camera for this site, or paste the code text below.",
      );
    }
  }, []);

  // The scanning loop: copy each video frame into a canvas, hand the
  // pixels to the QR reader, and stop as soon as one decodes.
  useEffect(() => {
    if (!isScanning) {
      return;
    }
    let timer: number | undefined;
    let cancelled = false;
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });

    (async () => {
      const jsQR = (await import("jsqr")).default;

      const tick = () => {
        if (cancelled) {
          return;
        }
        const video = videoRef.current;
        if (video && context && video.videoWidth > 0) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          const image = context.getImageData(0, 0, canvas.width, canvas.height);
          const result = jsQR(image.data, image.width, image.height);
          if (result) {
            try {
              const journeyFromCode = decodeSharedJourneyText(result.data);
              setScanned(journeyFromCode);
              setScanError("");
              stopCamera();
              return; // stop the loop, the driver now confirms
            } catch (error) {
              // A QR code that is not one of ours, keep looking rather
              // than failing the whole scan.
              setScanError(
                error instanceof Error ? error.message : "Unreadable code.",
              );
            }
          }
        }
        timer = window.setTimeout(tick, SCAN_INTERVAL_MS);
      };

      tick();
    })();

    return () => {
      cancelled = true;
      if (timer !== undefined) {
        window.clearTimeout(timer);
      }
    };
  }, [isScanning, stopCamera]);

  /** Reads a code the driver pasted, for when the camera is unavailable. */
  function readPastedCode() {
    setScanError("");
    try {
      setScanned(decodeSharedJourneyText(pastedCode.trim()));
    } catch (error) {
      setScanned(null);
      setScanError(
        error instanceof Error ? error.message : "That code could not be read.",
      );
    }
  }

  /**
   * Replaces this phone's journey with the scanned one, then rebuilds the
   * rest plan from the backend so the driver lands on a complete plan.
   * Anything left from the previous journey on this phone (chosen stops,
   * a navigation plan) is cleared, because it belongs to a different trip.
   */
  async function importScannedJourney() {
    if (!scanned) {
      return;
    }
    setIsImporting(true);
    setScanError("");
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(scanned));
      localStorage.removeItem(REST_PLAN_STORAGE_KEY);
      localStorage.removeItem(STOP_OVERRIDES_STORAGE_KEY);
      localStorage.removeItem(NAVIGATION_PLAN_STORAGE_KEY);
      localStorage.removeItem(NAVIGATION_PROGRESS_STORAGE_KEY);
    } catch {
      setScanError(
        "This browser would not save the journey. Check that storage is allowed for this site.",
      );
      setIsImporting(false);
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/journeys/rest-plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          departure_time: `${scanned.departureDate}T${scanned.departureTime}:00`,
          jurisdiction_code: scanned.jurisdictionCode,
          configuration: scanned.hasCoDriver ? "two_up" : "solo",
          total_driving_hours: Number(scanned.estimatedDrivingHours),
        }),
      });
      if (response.ok) {
        const plan: RestBreak[] = await response.json();
        localStorage.setItem(REST_PLAN_STORAGE_KEY, JSON.stringify(plan));
        router.push("/route-breaks");
        return;
      }
    } catch {
      // Fall through to the journey form below.
    }

    // The journey is saved either way. Without a rest plan the honest
    // next step is the form, where pressing Start Journey rebuilds it.
    router.push("/newjourney");
  }

  return (
    <main className="container mx-auto max-w-2xl px-4">
      <div className="flex min-h-screen flex-col gap-4 py-4">
        <header className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-muted">Journey</p>
            <h1 className="text-2xl font-bold">Share with another phone</h1>
          </div>
          <Link href="/route-breaks" className={GHOST_BUTTON_CLASS}>
            Back to plan
          </Link>
        </header>

        {/* Two modes, one at a time, so the camera is only ever running
            when the driver is actually scanning. */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              stopCamera();
              setMode("show");
            }}
            aria-pressed={mode === "show"}
            className={
              mode === "show" ? SECONDARY_BUTTON_CLASS : GHOST_BUTTON_CLASS
            }
          >
            <QrCode className="mr-2 h-4 w-4" aria-hidden />
            Show my journey
          </button>
          <button
            type="button"
            onClick={() => setMode("scan")}
            aria-pressed={mode === "scan"}
            className={
              mode === "scan" ? SECONDARY_BUTTON_CLASS : GHOST_BUTTON_CLASS
            }
          >
            <ScanLine className="mr-2 h-4 w-4" aria-hidden />
            Scan a journey
          </button>
        </div>

        {mode === "show" && (
          <section
            aria-labelledby="show-heading"
            className="rounded-xl border border-line bg-surface-alt p-4"
          >
            <h2 id="show-heading" className="text-lg font-bold">
              Your journey as a code
            </h2>
            {!isLoaded && (
              <div className="mt-3 h-[320px] rounded-xl bg-surface" />
            )}
            {isLoaded && !journey && (
              <div className="mt-3">
                <p className="text-sm text-muted">
                  There is no journey on this phone yet.
                </p>
                <Link
                  href="/newjourney"
                  className={`mt-3 ${PRIMARY_BUTTON_CLASS}`}
                >
                  Plan my journey
                </Link>
              </div>
            )}
            {isLoaded && journey && (
              <>
                <p className="mt-2 text-sm text-muted">
                  On the other phone, open RouteRest, go to Share and choose
                  Scan a journey, then point its camera at this code.
                </p>
                {showError && (
                  <p role="alert" className="mt-3 text-sm text-danger">
                    {showError}
                  </p>
                )}
                {qrDataUrl && (
                  <div className="mt-3 flex flex-col items-center gap-3">
                    {/* A plain white background matters: a QR code on a
                        tinted panel is harder for a camera to read. */}
                    <div className="rounded-xl bg-white p-3">
                      <Image
                        src={qrDataUrl}
                        alt="QR code containing this journey"
                        width={512}
                        height={512}
                        className="h-auto w-full max-w-[400px]"
                        unoptimized
                      />
                    </div>
                    <p className={`${HELPER_CLASS} text-center`}>
                      {describeJourney(journey)}
                    </p>
                  </div>
                )}
                <p className={`${HELPER_CLASS} mt-3`}>
                  The code holds only your journey details. Nothing is sent to a
                  server, and the other phone rebuilds the rest plan itself.
                </p>
              </>
            )}
          </section>
        )}

        {mode === "scan" && (
          <section
            aria-labelledby="scan-heading"
            className="rounded-xl border border-line bg-surface-alt p-4"
          >
            <h2 id="scan-heading" className="text-lg font-bold">
              Scan the other phone
            </h2>

            {!scanned && (
              <>
                <div className="mt-3 overflow-hidden rounded-xl bg-ink">
                  <video
                    ref={videoRef}
                    className="h-64 w-full object-cover"
                    playsInline
                    muted
                    aria-label="Camera view for scanning a journey code"
                  />
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {!isScanning ? (
                    <button
                      type="button"
                      onClick={startCamera}
                      className={SECONDARY_BUTTON_CLASS}
                    >
                      <Camera className="mr-2 h-4 w-4" aria-hidden />
                      Start camera
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={stopCamera}
                      className={GHOST_BUTTON_CLASS}
                    >
                      Stop camera
                    </button>
                  )}
                </div>
                <p className={`${HELPER_CLASS} mt-2`}>
                  Hold the other phone steady, filling about half the frame. The
                  camera only runs while this page is open.
                </p>

                <div className="mt-4 border-t border-line pt-3">
                  <label
                    htmlFor="pasted-code"
                    className="text-sm font-semibold"
                  >
                    No camera? Paste the code text
                  </label>
                  <input
                    id="pasted-code"
                    type="text"
                    value={pastedCode}
                    onChange={(event) => setPastedCode(event.target.value)}
                    placeholder="Paste the journey code here"
                    className={`${INPUT_CLASS} mt-2`}
                  />
                  <button
                    type="button"
                    onClick={readPastedCode}
                    disabled={pastedCode.trim().length === 0}
                    className={`${GHOST_BUTTON_CLASS} mt-2 disabled:opacity-50`}
                  >
                    Read pasted code
                  </button>
                </div>
              </>
            )}

            {scanError && (
              <p role="alert" className="mt-3 text-sm text-danger">
                {scanError}
              </p>
            )}

            {scanned && (
              <div className="mt-3 rounded-xl border border-brand bg-brand-tint p-3">
                <p className="text-sm font-bold text-brand-strong">
                  Journey found
                </p>
                <p className="mt-1 text-sm text-ink">
                  {describeJourney(scanned)}
                </p>
                <p className={`${HELPER_CLASS} mt-2`}>
                  Loading this journey replaces the one on this phone, including
                  any stops you picked.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={importScannedJourney}
                    disabled={isImporting}
                    className={`${PRIMARY_BUTTON_CLASS} disabled:opacity-60`}
                  >
                    {isImporting ? "Loading journey..." : "Load this journey"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setScanned(null);
                      setPastedCode("");
                    }}
                    className={GHOST_BUTTON_CLASS}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        <Disclaimer className="mt-2" />
      </div>
    </main>
  );
}
