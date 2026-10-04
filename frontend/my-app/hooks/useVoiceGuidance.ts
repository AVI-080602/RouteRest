"use client";

import { useSyncExternalStore } from "react";
import {
  getServerSnapshot,
  getSnapshot,
  setVoiceEnabled,
  subscribe,
  unlockVoice,
} from "@/utils/voiceGuidance";

/**
 * React view of the app's voice (utils/voiceGuidance.ts): whether the
 * driver has it on, whether the browser allows it, and whether it is
 * talking right now, plus the two controls the page draws buttons for.
 * Speaking itself is done by importing speak() from the module, which is
 * a plain function and safe to call from any callback or effect.
 *
 * Reads through useSyncExternalStore so the server render and the first
 * client render agree (voice on, availability unknown) and the real
 * preference is applied straight after hydration.
 */
export function useVoiceGuidance() {
  const snapshot = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  return {
    ...snapshot,
    setEnabled: setVoiceEnabled,
    unlock: unlockVoice,
  };
}
