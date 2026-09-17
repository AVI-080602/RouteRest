"use client";

import { useRef, useState } from "react";
import { FaceLandmarker } from "@mediapipe/tasks-vision";
import { createFaceLandmarker } from "@/utils/createFaceLandmarker";
import {
  analyzeEyeClosure,
  EYE_CLOSED_WARNING_MS,
} from "@/utils/fatigueDetection";

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
        eyeClosedStartTimeRef.current = null;
        setDrowsinessStatus("No face detected");
      } else {
        const landmarks = result.faceLandmarks[0]; // Get the first detected face's landmarks
        const { averageEar, eyesAreClosed } = analyzeEyeClosure(landmarks);

        const currentTime = performance.now(); // Get the current timestamp for drowsiness detection

        if (eyesAreClosed) {
          if (eyeClosedStartTimeRef.current === null) {
            eyeClosedStartTimeRef.current = currentTime;
          }

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
      faceLandmarkerRef.current = await createFaceLandmarker();
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
