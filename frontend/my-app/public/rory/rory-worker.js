/**
 * Rory's ears: turns microphone audio into sentences of text, on the phone.
 *
 * Runs as a Web Worker so the speech engine never blocks the navigation
 * page (decoding one sentence takes a few hundred milliseconds on a phone,
 * long enough to stutter the map). The page sends 16 kHz audio; this
 * worker sends back one message per spoken sentence. Nothing here sends
 * audio or text anywhere else, and nothing is stored.
 *
 * Two parts of the engine work together (see scripts/prepare-rory-voice.mjs
 * for what the engine is and why this version):
 *   1. Voice activity detection listens all the time. It is cheap (about
 *      1 to 2 percent of one CPU core in testing) and only notices when
 *      someone starts and stops talking.
 *   2. Speech recognition runs once per finished sentence, turning it into
 *      text. Ordinary conversation in the cab is transcribed too; the page
 *      ignores any sentence that does not start with "Hey Rory".
 *
 * Messages in:  { type: "audio", samples: Float32Array (16 kHz mono) }
 *               { type: "pause" }  drop audio, e.g. while the app is talking
 *               { type: "resume" }
 * Messages out: { type: "progress", loaded, total }  model download
 *               { type: "ready" }
 *               { type: "speech" }  someone started talking
 *               { type: "sentence", text, seconds }
 *               { type: "error", message }
 */
"use strict";

const SAMPLE_RATE = 16000;
// Silero VAD settings. A sentence ends after half a second of quiet, so a
// short pause between "Hey Rory" and the question usually keeps them
// together, and 20 seconds is far longer than any question to Rory.
const VAD_CONFIG = {
  sileroVad: {
    model: "./silero_vad.onnx",
    threshold: 0.5,
    minSilenceDuration: 0.5,
    minSpeechDuration: 0.25,
    maxSpeechDuration: 20,
    windowSize: 512,
  },
  sampleRate: SAMPLE_RATE,
  numThreads: 1,
  provider: "cpu",
  debug: 0,
  bufferSizeInSeconds: 30,
};

let vad = null;
let recognizer = null;
let buffer = null;
let paused = false;
let speaking = false;

// The engine's script expects a global "Module" to configure it before it
// loads. Its model files sit next to it in engine/.
self.Module = {
  locateFile(path, scriptDirectory) {
    return `${scriptDirectory || ""}engine/${path}`;
  },
  // The engine reports its model download as "Downloading data... (a/b)".
  setStatus(status) {
    const match = /\((\d+)\/(\d+)\)/.exec(status || "");
    if (match) {
      self.postMessage({
        type: "progress",
        loaded: Number(match[1]),
        total: Number(match[2]),
      });
    }
  },
  print() {},
  printErr() {},
  onRuntimeInitialized() {
    try {
      startEngine();
      self.postMessage({ type: "ready" });
    } catch (error) {
      self.postMessage({ type: "error", message: String(error) });
    }
  },
};

/** Creates the detector, the recogniser and the audio buffer between them. */
function startEngine() {
  // createVad, OfflineRecognizer and CircularBuffer come from the engine's
  // sherpa-onnx-vad.js and sherpa-onnx-asr.js, loaded below.
  vad = createVad(self.Module, VAD_CONFIG);
  recognizer = new OfflineRecognizer(
    {
      modelConfig: {
        debug: 0,
        tokens: "./tokens.txt",
        transducer: {
          encoder: "./transducer-encoder.onnx",
          decoder: "./transducer-decoder.onnx",
          joiner: "./transducer-joiner.onnx",
        },
        modelType: "transducer",
      },
    },
    self.Module,
  );
  buffer = new CircularBuffer(30 * SAMPLE_RATE, self.Module);
}

/** Text for one finished sentence. */
function transcribe(samples) {
  const stream = recognizer.createStream();
  stream.acceptWaveform(SAMPLE_RATE, samples);
  recognizer.decode(stream);
  const text = recognizer.getResult(stream).text.trim();
  stream.free();
  return text;
}

/** Sends every finished sentence, or throws them away while paused. */
function drainSentences() {
  while (!vad.isEmpty()) {
    const segment = vad.front();
    vad.pop();
    if (paused) {
      continue;
    }
    const text = transcribe(segment.samples);
    if (text) {
      self.postMessage({
        type: "sentence",
        text,
        seconds: segment.samples.length / SAMPLE_RATE,
      });
    }
  }
}

function acceptAudio(samples) {
  buffer.push(samples);
  const windowSize = VAD_CONFIG.sileroVad.windowSize;
  while (buffer.size() > windowSize) {
    vad.acceptWaveform(buffer.get(buffer.head(), windowSize));
    buffer.pop(windowSize);
  }
  const detected = vad.isDetected();
  if (detected && !speaking) {
    self.postMessage({ type: "speech" });
  }
  speaking = detected;
  drainSentences();
}

self.onmessage = (event) => {
  const message = event.data || {};
  if (!vad) {
    return;
  }
  try {
    if (message.type === "audio" && !paused) {
      acceptAudio(message.samples);
    } else if (message.type === "pause") {
      // Whatever was half heard when the app started talking is most
      // likely the app itself. Finish it off and throw it away. (The
      // engine's own reset is broken in this build, so flush is used.)
      paused = true;
      vad.flush();
      drainSentences();
      buffer.reset();
      speaking = false;
    } else if (message.type === "resume") {
      paused = false;
    }
  } catch (error) {
    self.postMessage({ type: "error", message: String(error) });
  }
};

try {
  importScripts(
    "engine/sherpa-onnx-vad.js",
    "engine/sherpa-onnx-asr.js",
    "engine/sherpa-onnx-wasm-main-vad-asr.js",
  );
} catch (error) {
  self.postMessage({
    type: "error",
    message: `Speech engine files are missing: ${String(error)}`,
  });
}
