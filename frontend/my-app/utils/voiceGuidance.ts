/**
 * One voice for the whole app.
 *
 * Until Iteration 3 the only thing RouteRest said aloud was the fatigue
 * reminder built from the driver's own State Check, so the first hook
 * simply called speechSynthesis.cancel() and spoke. Once turn-by-turn
 * directions, the camera's eyes-closed warning, off-route notices and
 * arrivals all talk, that approach makes them cut each other off: a turn
 * instruction would silence a fatigue warning half way through.
 *
 * This module is the single place speech is produced. It keeps two levels:
 *
 *   alert     Safety first. Fatigue (camera or self-report), off route,
 *             route changes. An alert interrupts guidance and is spoken at
 *             once; alerts wait for each other, in order, so none is cut
 *             short.
 *   guidance  Driving help. Turn instructions, arrivals, the start of a
 *             journey. Guidance never interrupts: it waits for whatever is
 *             playing, and only the newest waiting instruction is kept,
 *             because only the latest one is still true.
 *
 * Everything runs in the browser: the text never leaves the device, which
 * keeps the data management plan's "no journey data off the phone" promise.
 *
 * Why no React here: the camera loop and the re-route code call speak()
 * from callbacks and effects, and a plain module function is stable to
 * call from anywhere. React reads the state through hooks/useVoiceGuidance.
 */

export type VoicePriority = "alert" | "guidance";

/**
 * Whether this browser can speak at all, and whether it is letting us.
 *
 * "blocked" is Chrome's rule that speech needs a tap on the page first.
 * Reaching the navigation page by tapping Start Navigation counts, but a
 * reload of the page does not, so the page offers an Enable voice button.
 */
export type VoiceAvailability = "unknown" | "ready" | "unsupported" | "blocked";

/** What became of one request to speak. */
export type UtteranceStatus =
  | "playing"
  | "played"
  | "failed"
  | "unavailable"
  | "muted"
  // Cut off by the driver (Voice off, dismissing the alert) or by leaving
  // the page: nothing to show for it.
  | "stopped";

export type SpeakOptions = {
  priority: VoicePriority;
  /**
   * Requests with the same key inside the repeat window are dropped, so a
   * GPS fix every second cannot read the same instruction twice. Defaults
   * to the text itself.
   */
  key?: string;
  /** Bypass the repeat window: for a driver pressing a replay button. */
  force?: boolean;
  /**
   * Guidance on the same channel replaces guidance already waiting on
   * it. Turn instructions use this ("turn"): a newer one makes the older
   * one wrong. Guidance without a channel keeps its place in the queue.
   */
  channel?: string;
  onStatus?: (status: UtteranceStatus) => void;
};

export type VoiceGuidanceSnapshot = {
  /** The driver's on/off switch, kept in browser storage. Default on. */
  enabled: boolean;
  availability: VoiceAvailability;
  speaking: boolean;
};

// Key used to store the driver's voice on/off switch in localStorage.
export const VOICE_GUIDANCE_STORAGE_KEY = "voiceGuidanceEnabled";

// A camera warning fires once per eye closure, and closures come at least
// 1.5 s apart, so 3 s only removes true double fires.
const ALERT_REPEAT_WINDOW_MS = 3000;
// Turn instructions are requested on every GPS fix while a threshold is
// crossed; the page already announces each turn once per distance band,
// so this is a safety net rather than the main guard.
const GUIDANCE_REPEAT_WINDOW_MS = 10_000;
// Guidance held back by an alert is not worth saying once it is stale: the
// truck has moved on from where that instruction applied.
const PENDING_GUIDANCE_MAX_AGE_MS = 15_000;
// Chrome drops an utterance queued in the same tick as cancel(). A short
// gap between the two makes it reliable.
const CANCEL_THEN_SPEAK_DELAY_MS = 60;
// Chrome sometimes never reports the end of an utterance and then stays
// "speaking" for ever, swallowing everything after it. A generous timer,
// scaled to the length of the text, clears that state.
const WATCHDOG_MS_PER_CHARACTER = 90;
const WATCHDOG_EXTRA_MS = 4000;

type QueuedUtterance = {
  text: string;
  key: string;
  priority: VoicePriority;
  channel?: string;
  onStatus?: (status: UtteranceStatus) => void;
  queuedAt: number;
};

// More than this much guidance waiting means the driver is being talked at
// faster than they can listen; the oldest is dropped.
const MAX_PENDING_GUIDANCE = 3;

type ActiveUtterance = QueuedUtterance & {
  utterance: SpeechSynthesisUtterance;
  // Whether the engine ever reported this utterance starting. Safari
  // refuses speech without a tap silently, with no error event at all, so
  // "never started" is the only sign that the browser is blocking us.
  started: boolean;
};

const SERVER_SNAPSHOT: VoiceGuidanceSnapshot = {
  enabled: true,
  availability: "unknown",
  speaking: false,
};

let snapshot: VoiceGuidanceSnapshot = { ...SERVER_SNAPSHOT };
let hasLoadedPreference = false;
const listeners = new Set<() => void>();

let current: ActiveUtterance | null = null;
// Alerts wait for each other in order: a fatigue warning and an off-route
// notice are both worth hearing in full. Guidance waits behind everything.
let pendingAlerts: QueuedUtterance[] = [];
let pendingGuidance: QueuedUtterance[] = [];
const lastSpokenAt = new Map<string, number>();
let watchdog: number | null = null;

let voices: SpeechSynthesisVoice[] = [];
let isListeningForVoices = false;

function isSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    typeof SpeechSynthesisUtterance !== "undefined"
  );
}

function publish(partial: Partial<VoiceGuidanceSnapshot>) {
  const next = { ...snapshot, ...partial };
  if (
    next.enabled === snapshot.enabled &&
    next.availability === snapshot.availability &&
    next.speaking === snapshot.speaking
  ) {
    return;
  }
  snapshot = next;
  listeners.forEach((listener) => listener());
}

/**
 * Reads the driver's switch once. Called from getSnapshot, which React
 * runs during render, so it mutates quietly instead of notifying.
 */
function loadPreference() {
  if (hasLoadedPreference || typeof window === "undefined") {
    return;
  }
  hasLoadedPreference = true;
  try {
    if (localStorage.getItem(VOICE_GUIDANCE_STORAGE_KEY) === "false") {
      snapshot = { ...snapshot, enabled: false };
    }
  } catch {
    // Storage unavailable: voice stays on, nothing is remembered.
  }
}

/**
 * Voices arrive asynchronously in most browsers, so the list is refreshed
 * whenever the browser says it changed.
 */
function refreshVoices() {
  if (!isSupported()) {
    return;
  }
  if (!isListeningForVoices) {
    isListeningForVoices = true;
    window.speechSynthesis.addEventListener?.("voiceschanged", () => {
      voices = window.speechSynthesis.getVoices();
    });
  }
  if (voices.length === 0) {
    voices = window.speechSynthesis.getVoices();
  }
}

/**
 * An Australian English voice when the device has one. A voice installed
 * on the device is preferred over a network one: it keeps working with no
 * signal, which is where trucks spend much of their time. With no match
 * the utterance's lang still asks the engine for en-AU pronunciation.
 */
function pickVoice(): SpeechSynthesisVoice | undefined {
  refreshVoices();
  const australian = voices.filter((voice) => /^en[-_]AU/i.test(voice.lang));
  return australian.find((voice) => voice.localService) ?? australian[0];
}

function clearWatchdog() {
  if (watchdog !== null) {
    window.clearTimeout(watchdog);
    watchdog = null;
  }
}

// ---------------------------------------------------------------------
// Store interface for React (useSyncExternalStore).
// ---------------------------------------------------------------------

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  loadPreference();
  refreshVoices();
  return () => {
    listeners.delete(listener);
  };
}

export function getSnapshot(): VoiceGuidanceSnapshot {
  loadPreference();
  return snapshot;
}

export function getServerSnapshot(): VoiceGuidanceSnapshot {
  return SERVER_SNAPSHOT;
}

// ---------------------------------------------------------------------
// Controls.
// ---------------------------------------------------------------------

/** The driver's switch. Off stops anything playing and forgets the queue. */
export function setVoiceEnabled(enabled: boolean) {
  try {
    localStorage.setItem(VOICE_GUIDANCE_STORAGE_KEY, String(enabled));
  } catch {
    // Not remembered across visits, but applies to this one.
  }
  if (!enabled) {
    stopAllSpeech();
  }
  publish({ enabled });
}

/**
 * For a tap on an Enable voice button. Browsers that need a user gesture
 * before speaking accept this call because it runs inside one, and the
 * short confirmation tells the driver it worked.
 */
export function unlockVoice() {
  if (!isSupported()) {
    publish({ availability: "unsupported" });
    return;
  }
  if (!snapshot.enabled) {
    setVoiceEnabled(true);
  }
  speak("Voice guidance is on.", {
    priority: "alert",
    key: "voice-guidance-unlock",
    force: true,
  });
}

/** Silence everything, including guidance waiting its turn. */
export function stopAllSpeech() {
  const dropped: QueuedUtterance[] = [
    ...(current ? [current] : []),
    ...pendingAlerts,
    ...pendingGuidance,
  ];
  pendingAlerts = [];
  pendingGuidance = [];
  current = null;
  clearWatchdog();
  if (isSupported()) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      // Nothing was playing.
    }
  }
  publish({ speaking: false });
  // Whoever was waiting on these must not be left showing "playing".
  dropped.forEach((item) => item.onStatus?.("stopped"));
}

/**
 * Drop guidance on one channel, playing or waiting, and leave the rest.
 * The navigation page uses it to drop turn instructions the moment the
 * truck is off route, where they no longer apply.
 */
export function stopGuidanceChannel(channel: string) {
  pendingGuidance = pendingGuidance.filter((item) => item.channel !== channel);
  if (current?.priority === "guidance" && current.channel === channel) {
    const alerts = pendingAlerts;
    const guidance = pendingGuidance;
    stopAllSpeech();
    pendingAlerts = alerts;
    pendingGuidance = guidance;
    playNextQueued();
  }
}

/**
 * Stop one message by key (for example when its alert is dismissed),
 * leaving unrelated speech alone.
 */
export function stopSpeech(key: string) {
  pendingAlerts = pendingAlerts.filter((item) => item.key !== key);
  pendingGuidance = pendingGuidance.filter((item) => item.key !== key);
  if (current?.key === key) {
    const alerts = pendingAlerts;
    const guidance = pendingGuidance;
    stopAllSpeech();
    // Only the named message is stopped; what was waiting still plays.
    pendingAlerts = alerts;
    pendingGuidance = guidance;
    playNextQueued();
  }
}

function enqueueGuidance(item: QueuedUtterance) {
  pendingGuidance = pendingGuidance.filter(
    (waiting) =>
      waiting.key !== item.key &&
      (item.channel === undefined || waiting.channel !== item.channel),
  );
  pendingGuidance.push(item);
  if (pendingGuidance.length > MAX_PENDING_GUIDANCE) {
    pendingGuidance.shift();
  }
}

function enqueueAlert(item: QueuedUtterance) {
  pendingAlerts = pendingAlerts.filter((waiting) => waiting.key !== item.key);
  pendingAlerts.push(item);
}

/** Starts the next waiting message, alerts first, skipping stale guidance. */
function playNextQueued() {
  if (current !== null || !snapshot.enabled) {
    return;
  }
  const alert = pendingAlerts.shift();
  if (alert) {
    start(alert);
    return;
  }
  const now = Date.now();
  while (pendingGuidance.length > 0) {
    const next = pendingGuidance.shift() as QueuedUtterance;
    // Only channelled guidance (turn instructions) goes out of date; an
    // arrival or a found rest stop is worth hearing however long the
    // fatigue reminder before it took.
    const stale =
      next.channel !== undefined &&
      now - next.queuedAt > PENDING_GUIDANCE_MAX_AGE_MS;
    if (!stale) {
      lastSpokenAt.delete(next.key);
      start(next);
      return;
    }
  }
}

/**
 * Say something. Alerts interrupt guidance and queue behind other alerts;
 * guidance waits for everything. See the module comment for why.
 */
export function speak(text: string, options: SpeakOptions) {
  const message = text.trim();
  if (!message) {
    return;
  }
  loadPreference();
  if (!snapshot.enabled) {
    options.onStatus?.("muted");
    return;
  }
  if (!isSupported()) {
    publish({ availability: "unsupported" });
    options.onStatus?.("unavailable");
    return;
  }

  const key = options.key ?? message;
  const now = Date.now();
  const repeatWindow =
    options.priority === "alert"
      ? ALERT_REPEAT_WINDOW_MS
      : GUIDANCE_REPEAT_WINDOW_MS;
  const last = lastSpokenAt.get(key);
  if (!options.force && last !== undefined && now - last < repeatWindow) {
    return;
  }

  const item: QueuedUtterance = {
    text: message,
    key,
    priority: options.priority,
    channel: options.channel,
    onStatus: options.onStatus,
    queuedAt: now,
  };

  if (item.priority === "guidance") {
    if (current !== null) {
      // Never cut speech off for guidance: wait for the current message.
      enqueueGuidance(item);
      return;
    }
    start(item);
    return;
  }

  // An alert. Another alert in progress is heard out first; guidance in
  // progress is interrupted and put back in the queue, at the front, so
  // it is said once the alert is over if it is still fresh.
  if (current?.priority === "alert") {
    enqueueAlert(item);
    return;
  }
  if (current?.priority === "guidance") {
    const interrupted: QueuedUtterance = {
      text: current.text,
      key: current.key,
      priority: current.priority,
      channel: current.channel,
      onStatus: current.onStatus,
      queuedAt: now,
    };
    pendingGuidance = [
      interrupted,
      ...pendingGuidance.filter(
        (waiting) =>
          waiting.key !== interrupted.key &&
          (interrupted.channel === undefined ||
            waiting.channel !== interrupted.channel),
      ),
    ];
  }
  start(item);
}

function start(item: QueuedUtterance) {
  const synth = window.speechSynthesis;
  clearWatchdog();

  const wasBusy = current !== null || synth.speaking || synth.pending;
  // Clearing `current` first means the old utterance's end or error event
  // is recognised as ours and ignored.
  current = null;
  if (wasBusy) {
    try {
      synth.cancel();
    } catch {
      // Nothing to cancel.
    }
  }

  const utterance = new SpeechSynthesisUtterance(item.text);
  utterance.lang = "en-AU";
  const voice = pickVoice();
  if (voice) {
    utterance.voice = voice;
  }
  utterance.rate = 0.95;
  utterance.pitch = 1;
  utterance.volume = 1;

  const entry: ActiveUtterance = { ...item, utterance, started: false };
  current = entry;
  lastSpokenAt.set(item.key, Date.now());

  utterance.onstart = () => {
    if (current !== entry) {
      return;
    }
    entry.started = true;
    publish({ availability: "ready", speaking: true });
    entry.onStatus?.("playing");
  };
  utterance.onend = () => finish(entry, "played");
  utterance.onerror = (event) => {
    if (current !== entry) {
      // Cancelled by us to make way for something newer: not an error.
      return;
    }
    if (event.error === "not-allowed") {
      // The browser wants a tap before it will speak.
      publish({ availability: "blocked" });
    }
    finish(entry, "failed");
  };

  const go = () => {
    if (current !== entry) {
      return;
    }
    try {
      // iOS Safari can be left paused after the screen locks mid-sentence,
      // and then queues new speech for ever. Resume first.
      if (synth.paused) {
        synth.resume();
      }
      synth.speak(utterance);
    } catch {
      finish(entry, "failed");
      return;
    }
    watchdog = window.setTimeout(
      () => {
        if (current !== entry) {
          return;
        }
        // The engine never told us this finished. Clear it so the next
        // message is not stuck behind a ghost.
        try {
          synth.cancel();
        } catch {
          // Already idle.
        }
        if (!entry.started) {
          // It never began. On Safari that is how "tap first" shows up.
          if (snapshot.availability !== "ready") {
            publish({ availability: "blocked" });
          }
          finish(entry, "failed");
          return;
        }
        finish(entry, "played");
      },
      item.text.length * WATCHDOG_MS_PER_CHARACTER + WATCHDOG_EXTRA_MS,
    );
  };

  if (wasBusy) {
    window.setTimeout(go, CANCEL_THEN_SPEAK_DELAY_MS);
  } else {
    go();
  }
}

function finish(entry: ActiveUtterance, outcome: UtteranceStatus) {
  if (current !== entry) {
    return;
  }
  current = null;
  clearWatchdog();
  entry.onStatus?.(outcome);
  publish({ speaking: false });
  playNextQueued();
}

// ---------------------------------------------------------------------
// Wording helpers shared by the pages that speak.
// ---------------------------------------------------------------------

/**
 * A distance as a voice would say it: "1.2 kilometres", "350 metres".
 * Under a kilometre it rounds to 50 m, like the on-screen figure, and
 * 950 m and above becomes "1 kilometre" so nobody hears "1000 metres".
 */
export function spokenDistance(km: number): string {
  if (km >= 0.95) {
    const rounded = km < 10 ? Math.round(km * 10) / 10 : Math.round(km);
    const text = Number.isInteger(rounded) ? `${rounded}` : rounded.toFixed(1);
    return `${text} ${rounded === 1 ? "kilometre" : "kilometres"}`;
  }
  const metres = Math.max(50, Math.round((km * 1000) / 50) * 50);
  return `${metres} metres`;
}

/**
 * A duration as a voice would say it: "1 hour 30 minutes", "45 minutes".
 * The on-screen "1 h 30 min" is read out letter by letter by some voices.
 */
export function spokenMinutes(totalMinutes: number): string {
  const rounded = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(rounded / 60);
  const minutes = rounded % 60;
  const parts: string[] = [];
  if (hours > 0) {
    parts.push(`${hours} ${hours === 1 ? "hour" : "hours"}`);
  }
  if (minutes > 0 || hours === 0) {
    parts.push(`${minutes} ${minutes === 1 ? "minute" : "minutes"}`);
  }
  return parts.join(" ");
}

/** "Turn left onto X" becomes "turn left onto X" for use mid-sentence. */
export function lowerFirst(text: string): string {
  return text.length > 0 ? text[0].toLowerCase() + text.slice(1) : text;
}
