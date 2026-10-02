"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { speak, stopSpeech, type UtteranceStatus } from "@/utils/voiceGuidance";

/**
 * Playback state of one spoken alert, for the text shown under its
 * Play Voice Warning button.
 *
 * "muted" is new in Iteration 3: the driver has turned voice off on the
 * navigation page, so the alert is shown but deliberately not spoken.
 */
export type VoicePlaybackStatus = "idle" | UtteranceStatus;

/**
 * Speaks one alert once per alertKey, with a replay button's worth of
 * control (play, stop, status).
 *
 * Iteration 2 built this directly on speechSynthesis and cancelled
 * whatever was playing before speaking. Now that turn instructions, the
 * camera warning and off-route notices also talk, it goes through the
 * shared voice in utils/voiceGuidance.ts as an alert, so it interrupts
 * driving guidance rather than being interrupted by it, and the hook's
 * interface stays the same for the page that uses it.
 */
export function useVoiceAlert({
  alertKey,
  message,
}: {
  alertKey: string | null;
  message: string | null;
}) {
  const [status, setStatus] = useState<VoicePlaybackStatus>("idle");

  const lastAttemptedAlertRef = useRef<string | null>(null);

  const play = useCallback(() => {
    if (!message) {
      return;
    }
    setStatus("idle");
    speak(message, {
      priority: "alert",
      key: alertKey ?? message,
      // The effect below already limits automatic playback to once per
      // alert; a driver pressing the button should always be obeyed.
      force: true,
      onStatus: setStatus,
    });
  }, [alertKey, message]);

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
    const key = alertKey ?? message;
    if (key) {
      stopSpeech(key);
    }
    setStatus("idle");
  }, [alertKey, message]);

  return {
    status,
    play,
    stop,
  };
}
