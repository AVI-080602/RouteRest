import { FaceLandmarker } from "@mediapipe/tasks-vision";
import { createFaceLandmarker } from "@/utils/createFaceLandmarker";

type CameraMonitoringSession = {
  stream: MediaStream;
  faceLandmarker: FaceLandmarker;
};

// Singleton pattern for managing the active camera monitoring session.
let activeStream: MediaStream | null = null;
let faceLandmarkerPromise: Promise<FaceLandmarker> | null = null;

/**
 * Checks if the given MediaStream has at least one live video track.
 * @param stream The MediaStream object to check for live video tracks.
 * @returns True if the stream has at least one live video track, false otherwise.
 */
function hasLiveVideoTrack(stream: MediaStream | null) {
  return stream?.getVideoTracks().some((track) => track.readyState === "live");
}

/**
 * Retrieves the currently active camera monitoring stream, if available and live.
 * @returns The active MediaStream object, or null if no live stream is available.
 */
export function getActiveCameraMonitoringStream() {
  // If the active stream is not live, clear it.
  if (!hasLiveVideoTrack(activeStream)) {
    activeStream = null;
  }

  return activeStream;
}

/**
 * Starts a new camera monitoring session by obtaining a live video stream and initializing the face landmarker.
 * @returns A promise that resolves to a CameraMonitoringSession object containing the active stream and face landmarker.
 */
export async function startCameraMonitoringSession(): Promise<CameraMonitoringSession> {
  // If there is no live video track in the active stream, request a new camera stream from the user.
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
  
  // Initialize the face landmarker if it hasn't been created yet.
  faceLandmarkerPromise ??= createFaceLandmarker();

  return {
    stream,
    faceLandmarker: await faceLandmarkerPromise,
  };
}

/**
 * Attaches the given camera stream to the specified HTMLVideoElement for playback.
 * @param videoElement The HTMLVideoElement to attach the camera stream to.
 * @param stream The MediaStream object representing the camera stream.
 */
export function attachCameraStreamToVideo(
  videoElement: HTMLVideoElement | null,
  stream: MediaStream | null,
) {
  if (videoElement) {
    videoElement.srcObject = stream; // Connects live or programmatic media streams directly to HTML media elements
  }
}

/**
 * Stops the currently active camera monitoring session by stopping all tracks of the active stream and clearing the active stream reference.
 * @returns void
 */
export function stopCameraMonitoringSession() {
  activeStream?.getTracks().forEach((track) => track.stop());
  activeStream = null;
}
