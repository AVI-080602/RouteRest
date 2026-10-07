"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Rory's microphone: captures audio on the navigation page and hands it to
 * the speech engine in public/rory/rory-worker.js, which sends back one
 * line of text per spoken sentence.
 *
 * Everything stays on the phone. The audio goes from the microphone to the
 * worker inside this page and nowhere else, it is never recorded, and the
 * text is handed to the page and then forgotten (see the data management
 * plan). The page decides what, if anything, a sentence means.
 *
 * Browsers only allow the microphone once the driver has granted it, and
 * Chrome and Safari also want a tap on the page before audio can start.
 * Arriving here by tapping Start Navigation counts as that tap; reloading
 * the page does not, which is the "needs-tap" state.
 */

export type RoryListenerStatus =
  | "off" // turned off by the driver
  | "unsupported" // this browser cannot run the speech engine
  | "loading" // downloading or starting the speech engine
  | "needs-tap" // the browser wants a tap before audio can start
  | "denied" // microphone permission refused
  | "listening"
  | "failed"; // the engine could not start

type Options = {
  enabled: boolean;
  /** Stop listening while the app itself is talking, so it cannot hear itself. */
  paused: boolean;
  onSentence: (text: string) => void;
};

// Where the engine lives. A root path, so it also works under /iteration3
// (that prefix is rewritten to the root, see next.config.ts).
const WORKER_URL = "/rory/rory-worker.js";
const TARGET_RATE = 16000;

/*
 * The audio worklet that hands microphone samples to this page in blocks
 * of 2048 (about 43 ms at 48 kHz). Written as a string because a worklet
 * must be loaded from its own script; a blob URL avoids shipping a second
 * public file for twelve lines.
 */
const CAPTURE_WORKLET = `
class RoryCapture extends AudioWorkletProcessor {
  constructor() { super(); this.block = new Float32Array(2048); this.filled = 0; }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) {
      for (let i = 0; i < channel.length; i += 1) {
        this.block[this.filled++] = channel[i];
        if (this.filled === this.block.length) {
          this.port.postMessage(this.block);
          this.block = new Float32Array(2048);
          this.filled = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor("rory-capture", RoryCapture);
`;

/**
 * Averages blocks of samples down to 16 kHz, the rate the speech engine
 * expects. Phones record at 44.1 or 48 kHz; averaging is enough for speech
 * and far cheaper than a proper resampler.
 */
function downsample(input: Float32Array, rate: number): Float32Array {
  if (rate === TARGET_RATE) {
    return input.slice();
  }
  const ratio = rate / TARGET_RATE;
  const output = new Float32Array(Math.floor(input.length / ratio));
  let from = 0;
  for (let i = 0; i < output.length; i += 1) {
    const to = Math.round((i + 1) * ratio);
    let sum = 0;
    let count = 0;
    for (let j = from; j < to && j < input.length; j += 1) {
      sum += input[j];
      count += 1;
    }
    output[i] = count > 0 ? sum / count : 0;
    from = to;
  }
  return output;
}

function isSupported() {
  return (
    typeof window !== "undefined" &&
    typeof Worker !== "undefined" &&
    typeof WebAssembly !== "undefined" &&
    typeof AudioWorkletNode !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia
  );
}

export function useRoryListener({ enabled, paused, onSentence }: Options) {
  const [status, setStatus] = useState<RoryListenerStatus>("off");
  // Model download progress while loading, in bytes.
  const [progress, setProgress] = useState<{
    loaded: number;
    total: number;
  } | null>(null);

  const workerRef = useRef<Worker | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const engineReadyRef = useRef(false);
  const pausedRef = useRef(paused);
  // The latest callback, so a new render does not restart the microphone.
  const onSentenceRef = useRef(onSentence);
  useEffect(() => {
    onSentenceRef.current = onSentence;
  }, [onSentence]);

  /** Starts the microphone and the audio path into the worker. */
  const startAudio = useCallback(async () => {
    const worker = workerRef.current;
    if (!worker) return;
    try {
      if (!streamRef.current) {
        streamRef.current = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            // The phone's own echo cancelling stops Rory hearing the
            // app's voice through the speaker; the others help in a cab.
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
      }
    } catch (error) {
      setStatus(
        error instanceof DOMException && error.name === "NotAllowedError"
          ? "denied"
          : "failed",
      );
      return;
    }

    let context = contextRef.current;
    if (!context) {
      try {
        // Asking for 16 kHz saves resampling where the browser allows it.
        context = new AudioContext({ sampleRate: TARGET_RATE });
      } catch {
        context = new AudioContext();
      }
      contextRef.current = context;
      const workletUrl = URL.createObjectURL(
        new Blob([CAPTURE_WORKLET], { type: "application/javascript" }),
      );
      try {
        await context.audioWorklet.addModule(workletUrl);
      } finally {
        URL.revokeObjectURL(workletUrl);
      }
      const source = context.createMediaStreamSource(streamRef.current);
      const capture = new AudioWorkletNode(context, "rory-capture");
      // A silent route to the speakers keeps the worklet running in every
      // browser; some stop processing nodes that lead nowhere.
      const silent = context.createGain();
      silent.gain.value = 0;
      source.connect(capture).connect(silent).connect(context.destination);
      const rate = context.sampleRate;
      capture.port.onmessage = (event: MessageEvent<Float32Array>) => {
        if (!engineReadyRef.current || pausedRef.current) return;
        const samples = downsample(event.data, rate);
        worker.postMessage({ type: "audio", samples }, [samples.buffer]);
      };
    }

    if (context.state !== "running") {
      try {
        await context.resume();
      } catch {
        // Handled below.
      }
    }
    setStatus(context.state === "running" ? "listening" : "needs-tap");
  }, []);

  /** For the "Start Rory" button: the tap the browser was waiting for. */
  const start = useCallback(() => {
    void startAudio();
  }, [startAudio]);

  useEffect(() => {
    if (!enabled) {
      queueMicrotask(() => setStatus("off"));
      return;
    }
    if (!isSupported()) {
      queueMicrotask(() => setStatus("unsupported"));
      return;
    }

    queueMicrotask(() => setStatus("loading"));
    const worker = new Worker(WORKER_URL);
    workerRef.current = worker;
    worker.onmessage = (event) => {
      const message = event.data;
      if (message.type === "progress") {
        setProgress({ loaded: message.loaded, total: message.total });
      } else if (message.type === "ready") {
        engineReadyRef.current = true;
        setProgress(null);
        void startAudio();
      } else if (message.type === "sentence") {
        onSentenceRef.current(message.text);
      } else if (message.type === "error") {
        setStatus("failed");
      }
    };
    worker.onerror = () => setStatus("failed");

    return () => {
      engineReadyRef.current = false;
      worker.terminate();
      workerRef.current = null;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      void contextRef.current?.close().catch(() => {});
      contextRef.current = null;
    };
  }, [enabled, startAudio]);

  // While the app talks, the worker drops what it hears (see rory-worker.js).
  useEffect(() => {
    pausedRef.current = paused;
    workerRef.current?.postMessage({ type: paused ? "pause" : "resume" });
  }, [paused]);

  return { status, progress, start };
}
