"use client";

import { useEffect, useState } from "react";
import { Volume2 } from "lucide-react";
import {
  englishVoices,
  getVoiceChoice,
  onVoicesChanged,
  setVoiceChoice,
  speak,
} from "@/utils/voiceGuidance";
import { SECONDARY_BUTTON_CLASS, SELECT_CLASS } from "@/utils/ui";

/**
 * Rory's voice, chosen by ear (17 October 2026, after drivers found the
 * default "very robotic"). Lists this phone's English voices with the most
 * natural-sounding first (utils/voiceGuidance.ts voiceScore); "Automatic"
 * keeps that ranking. The choice stays on this phone. Voices that need
 * signal say so, because trucks often drive without it; if one fails, the
 * app falls back to an installed voice by itself.
 */
export default function VoicePicker() {
  const [options, setOptions] = useState<{ uri: string; label: string }[]>([]);
  const [choice, setChoice] = useState("");

  useEffect(() => {
    const load = () => {
      setOptions(
        englishVoices().map((voice) => ({
          uri: voice.voiceURI,
          label: `${voice.name}${voice.localService ? "" : " (needs signal)"}`,
        })),
      );
      setChoice(getVoiceChoice() ?? "");
    };
    queueMicrotask(load);
    return onVoicesChanged(load);
  }, []);

  if (options.length === 0) {
    return null;
  }

  function preview() {
    speak("Hi, I'm Rory. This is how I'll sound on the road.", {
      priority: "alert",
      key: "voice-preview",
      force: true,
      ignoreMute: true,
    });
  }

  return (
    <section
      aria-label="Rory's voice"
      className="flex flex-col gap-2 rounded-xl border border-line bg-surface-alt px-4 py-3 text-sm text-ink"
    >
      <label className="flex flex-col gap-1">
        <span className="font-semibold">Rory&rsquo;s voice</span>
        <select
          value={choice}
          onChange={(event) => {
            setChoice(event.target.value);
            setVoiceChoice(event.target.value || null);
          }}
          className={SELECT_CLASS}
        >
          <option value="">Automatic (most natural available)</option>
          {options.map((option) => (
            <option key={option.uri} value={option.uri}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        onClick={preview}
        className={`self-start ${SECONDARY_BUTTON_CLASS}`}
      >
        <Volume2 className="h-4 w-4" aria-hidden />
        Try it
      </button>
    </section>
  );
}
