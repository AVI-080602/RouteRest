import { FaceLandmarker } from "@mediapipe/tasks-vision";
import { createFaceLandmarker } from "@/utils/createFaceLandmarker";

type CameraMonitoringSession = {
  stream: MediaStream;
  faceLandmarker: FaceLandmarker;
};

let activeStream: MediaStream | null = null;
let faceLandmarkerPromise: Promise<FaceLandmarker> | null = null;

function hasLiveVideoTrack(stream: MediaStream | null) {
  return stream?.getVideoTracks().some((track) => track.readyState === "live");
}

export function getActiveCameraMonitoringStream() {
  if (!hasLiveVideoTrack(activeStream)) {
    activeStream = null;
  }

  return activeStream;
}

export async function startCameraMonitoringSession(): Promise<CameraMonitoringSession> {
  if (!hasLiveVideoTrack(activeStream)) {
    activeStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: false,
    });
  }

  const stream = activeStream;

  if (!stream) {
    throw new Error("Camera stream could not be started.");
  }

  faceLandmarkerPromise ??= createFaceLandmarker();

  return {
    stream,
    faceLandmarker: await faceLandmarkerPromise,
  };
}

// MediaPipe refuses a video frame whose timestamp is not later than the
// last one it was given, and the detector above is shared by everything
// on the page. Two detection loops running at once, for example one that
// has not stopped yet and a new one that just started, would otherwise
// interleave their timestamps and the detector would throw. Handing out
// timestamps from one place keeps them increasing however many loops run.
let lastVideoTimestamp = 0;

export function nextVideoTimestamp(): number {
  const now = performance.now();
  lastVideoTimestamp = now > lastVideoTimestamp ? now : lastVideoTimestamp + 1;
  return lastVideoTimestamp;
}

export function attachCameraStreamToVideo(
  videoElement: HTMLVideoElement | null,
  stream: MediaStream | null,
) {
  if (videoElement) {
    videoElement.srcObject = stream;
  }
}

export function stopCameraMonitoringSession() {
  activeStream?.getTracks().forEach((track) => track.stop());
  activeStream = null;
}
