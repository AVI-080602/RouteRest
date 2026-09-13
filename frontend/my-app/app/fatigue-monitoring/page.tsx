"use client";

import { useRef, useState } from "react";
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

type LandmarkPoint = {
  x: number;
  y: number;
  z?: number;
};

// Landmarks for the left and right eyes in the face mesh model
const LEFT_EYE_LANDMARKS = [362, 385, 387, 263, 373, 380];
const RIGHT_EYE_LANDMARKS = [33, 160, 158, 133, 153, 144];
const EAR_THRESHOLD = 0.18; // Threshold to determine if eyes are closed
const EYE_CLOSED_WARNING_MS = 1500;


  /**
   * Calculate the Euclidean distance between two 3D points.
   * @param point1 - The first point.
   * @param point2 - The second point.
   * @returns The Euclidean distance between the two points.
   */
const getDistance = (point1: LandmarkPoint, point2: LandmarkPoint): number =>
  Math.sqrt((point1.x - point2.x) ** 2 + (point1.y - point2.y) ** 2);

/**
 * Calculate the eye aspect ratio (EAR) for a given eye based on its landmarks.
 * @param eyeLandmarks - Array of landmark points for the eye.
 * @param eyePoints - Indices of the eye landmarks in the face mesh model.
 * @returns The eye aspect ratio (EAR) for the given eye.
 */
const getEyeAspectRatio = (
  eyeLandmarks: LandmarkPoint[],
  eyePoints: number[],
): number => {
  // Map the eye points to their corresponding landmark positions
  const [p1, p2, p3, p4, p5, p6] = eyePoints.map(
    (index) => eyeLandmarks[index],
  );

  const vertical1 = getDistance(p2, p6);
  const vertical2 = getDistance(p3, p5);
  const horizontal = getDistance(p1, p4);

  return (vertical1 + vertical2) / (2.0 * horizontal);
};

/**
 * Calculate the average eye aspect ratio (EAR) for both eyes.
 * @param leftEAR - The eye aspect ratio (EAR) for the left eye.
 * @param rightEAR - The eye aspect ratio (EAR) for the right eye.
 * @returns The average eye aspect ratio (EAR) for both eyes.
 */
const avgEyeAspectRatio = (leftEAR: number, rightEAR: number): number =>
  (leftEAR + rightEAR) / 2.0;

export default function FatigueMonitoringPage() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState("Camera off");
  const faceLandmarkerRef = useRef<FaceLandmarker | null>(null);
  const [modelStatus, setModelStatus] = useState("Model not loaded");
  const animationFrameRef = useRef<number | null>(null);
  const [eyeStatus, setEyeStatus] = useState("No eye analysis yet");
  const eyeClosedStartTimeRef = useRef<number | null>(null);
  const [drowsinessStatus, setDrowsinessStatus] = useState("No warning");

  // temp
  const [faceStatus, setFaceStatus] = useState("No analysis yet");

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
        animationFrameRef.current = window.requestAnimationFrame(detectFrame);
        return;
      }

      const result = faceLandmarkerRef.current.detectForVideo(
        videoRef.current,
        performance.now(),
      );

      if (result.faceLandmarks.length === 0) {
        setFaceStatus("No face detected");
        setEyeStatus("No eye analysis available");
      } else {
        const landmarks = result.faceLandmarks[0]; // Get the first detected face's landmarks

        const leftEar = getEyeAspectRatio(landmarks, LEFT_EYE_LANDMARKS);
        const rightEar = getEyeAspectRatio(landmarks, RIGHT_EYE_LANDMARKS);
        const averageEar = avgEyeAspectRatio(leftEar, rightEar);

        const eyesAreClosed = averageEar < EAR_THRESHOLD;

        const currentTime = performance.now(); // Get the current timestamp for drowsiness detection

        if (eyesAreClosed) {
          if (eyeClosedStartTimeRef.current === null) {
            eyeClosedStartTimeRef.current = currentTime;
          }

          const eyeClosedDuration = currentTime - eyeClosedStartTimeRef.current;

          const closedDuration = currentTime - eyeClosedStartTimeRef.current;

          if (closedDuration >= EYE_CLOSED_WARNING_MS) {
            setDrowsinessStatus("Warning: eyes closed for too long");
          } else {
            setDrowsinessStatus(
              `Eyes closed for ${(closedDuration / 1000).toFixed(1)}s`,
            );
          }
        } else {
          eyeClosedStartTimeRef.current = null;
          setDrowsinessStatus("No warning");
        }

        setFaceStatus(`Face detected: ${landmarks.length} landmarks`);
        setEyeStatus(
          `EAR: ${averageEar.toFixed(3)} - Eyes ${
            eyesAreClosed ? "closed" : "open"
          }`,
        );
      }

      // Continue the detection loop for the next frame according to the browser's refresh rate
      animationFrameRef.current = window.requestAnimationFrame(detectFrame);
    };

    detectFrame(); // Start the detection loop immediately after defining it
  };

  const loadFaceLandmarker = async () => {
    setModelStatus("Loading model...");

    try {
      // Initialize the environment for MediaPipe Vision tasks
      const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm",
      );

      // Create the face landmarker instance with the specified options
      const faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: "/models/face_landmarker.task",
        },
        runningMode: "VIDEO",
        numFaces: 1,
      });
      faceLandmarkerRef.current = faceLandmarker;
      setModelStatus("Model loaded successfully");
    } catch (error) {
      setModelStatus("Failed to load model");
      console.error(error);
    }
  };

  const startCamera = async () => {
    /* Start the media stream and activate the camera */
    try {
      // Request access to the user's camera
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false,
      });

      streamRef.current = stream; // Store the media stream reference for later use

      // Set the video element's source to the obtained media stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }

      setStatus("Camera active");
    } catch {
      setStatus("Could not access camera");
    }
  };

  const stopCamera = () => {
    /* Stop the media stream and release the camera */
    if (animationFrameRef.current) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    streamRef.current?.getTracks().forEach((track) => track.stop()); // Stop all tracks of the media stream (audio and video)
    streamRef.current = null;

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setStatus("Camera off");
  };

  return (
    <main>
      <h1>Fatigue Monitoring</h1>

      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={{ width: "400px", background: "black" }}
      />

      <p>{status}</p>

      <button type="button" onClick={startCamera}>
        Camera ON
      </button>

      <button type="button" onClick={stopCamera}>
        Camera OFF
      </button>
      <button type="button" onClick={loadFaceLandmarker}>
        Load Face Model
      </button>

      <p>{modelStatus}</p>

      <button type="button" onClick={startDetectionLoop}>
        Start Live Detection
      </button>

      <p>{faceStatus}</p>
      <p>{eyeStatus}</p>
      <p>{drowsinessStatus}</p>
    </main>
  );
}
