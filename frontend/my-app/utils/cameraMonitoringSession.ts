import { FaceLandmarker } from "@mediapipe/tasks-vision";
import { createFaceLandmarker } from "@/utils/createFaceLandmarker";

type CameraMonitoringSession = {
  stream: MediaStream;
  faceLandmarker: FaceLandmarker;
};

let activeStream: MediaStream | null = null;
let activeStreamRequest: Promise<MediaStream> | null = null;
let faceLandmarkerPromise: Promise<FaceLandmarker> | null = null;
let stopVersion = 0;

function hasLiveVideoTrack(stream: MediaStream | null) {
  return stream?.getVideoTracks().some((track) => track.readyState === "live");
}

function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

export function getActiveCameraMonitoringStream() {
  if (!hasLiveVideoTrack(activeStream)) {
    activeStream = null;
  }

  return activeStream;
}

async function getCameraStream() {
  const liveStream = getActiveCameraMonitoringStream();

  if (liveStream) {
    return liveStream;
  }

  if (!activeStreamRequest) {
    const requestStopVersion = stopVersion;

    const request = navigator.mediaDevices
      .getUserMedia({
        video: true,
        audio: false,
      })
      .then((stream) => {
        // A driver may press "Turn Camera Off" while the browser
        // permission/device request is still pending. getUserMedia cannot
        // be cancelled, so stop the late stream immediately instead of
        // letting it turn the camera back on by itself.
        if (requestStopVersion !== stopVersion) {
          stopStream(stream);
          throw new Error("Camera stream was stopped before it was ready.");
        }

        const existingStream = getActiveCameraMonitoringStream();
        if (existingStream) {
          stopStream(stream);
          return existingStream;
        }

        activeStream = stream;
        return stream;
      });

    activeStreamRequest = request;
    request
      .catch(() => undefined)
      .then(() => {
        if (activeStreamRequest === request) {
          activeStreamRequest = null;
        }
      });
  }

  return activeStreamRequest;
}

async function getFaceLandmarker() {
  if (!faceLandmarkerPromise) {
    faceLandmarkerPromise = createFaceLandmarker().catch((error) => {
      // Allow Try Again to make a fresh model request after one load fails.
      faceLandmarkerPromise = null;
      throw error;
    });
  }

  return faceLandmarkerPromise;
}

export async function startCameraMonitoringSession(): Promise<CameraMonitoringSession> {
  const stream = await getCameraStream();

  if (!hasLiveVideoTrack(stream)) {
    throw new Error("Camera stream could not be started.");
  }

  const faceLandmarker = await getFaceLandmarker();

  if (!hasLiveVideoTrack(stream) || activeStream !== stream) {
    throw new Error("Camera monitoring stopped before the model loaded.");
  }

  return {
    stream,
    faceLandmarker,
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
  stopVersion += 1;
  activeStreamRequest = null;
  stopStream(activeStream);
  activeStream = null;
}
