"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type VoicePlaybackStatus =
  | "idle"
  | "playing"
  | "played"
  | "unavailable"
  | "failed";

export function useVoiceAlert({
  alertKey,
  message,
}: {
  alertKey: string | null;
  message: string | null;
}) {
  const [status, setStatus] =
    useState<VoicePlaybackStatus>("idle");

  const lastAttemptedAlertRef = useRef<string | null>(null);

  const play = useCallback(() => {
    if (!message) {
      return;
    }

    if (
      typeof window === "undefined" ||
      !("speechSynthesis" in window) ||
      typeof SpeechSynthesisUtterance === "undefined"
    ) {
      setStatus("unavailable");
      return;
    }

    const utterance = new SpeechSynthesisUtterance(message);

    utterance.lang = "en-AU";
    utterance.rate = 0.95;
    utterance.pitch = 1;
    utterance.volume = 1;

    utterance.onstart = () => {
      setStatus("playing");
    };

    utterance.onend = () => {
      setStatus("played");
    };

    utterance.onerror = () => {
      setStatus("failed");
    };

    try {
      setStatus("idle");
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
    } catch {
      setStatus("failed");
    }
  }, [message]);

  useEffect(() => {
    if (!alertKey) {
      lastAttemptedAlertRef.current = null;
      return;
    }

    if (lastAttemptedAlertRef.current === alertKey) {
      return;
    }

    lastAttemptedAlertRef.current = alertKey;
    queueMicrotask(play);
  }, [alertKey, play]);

  const stop = useCallback(() => {
    if (
      typeof window !== "undefined" &&
      "speechSynthesis" in window
    ) {
      window.speechSynthesis.cancel();
    }

    setStatus("idle");
  }, []);

  return {
    status,
    play,
    stop,
  };
}