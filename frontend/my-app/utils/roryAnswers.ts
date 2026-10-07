/**
 * What Rory says back, for the questions in roryIntents.ts.
 *
 * Every answer is built from information the navigation page already
 * shows: the route, the rest plan, the State Check and the camera's
 * warnings. Rory never works anything out that the app has not already
 * worked out. That is the Epic 5 boundary: it does not judge fatigue, it
 * does not choose where the driver stops, and it does not change the
 * plan. It retrieves and explains.
 *
 * Wording is written to be heard, not read: "1.2 kilometres", not
 * "1.2 km", and "about 6:40 pm" rather than a date and time. Answers
 * never say "Hey Rory" either, so the app cannot wake itself up.
 */
import { spokenDistance, spokenMinutes } from "./voiceGuidance";
import type { RoryIntent } from "./roryIntents";

export type RoryWaypoint = {
  kind: "departure" | "stop" | "destination";
  name: string;
  /** Along-route distance from the truck, when the position is known. */
  distanceKm: number | null;
  /** Planned rest at a stop, in minutes. */
  restMinutes: number | null;
  /** Facility labels as the rest area data gives them ("Toilets", "Fuel"). */
  facilities: string[];
  isFinal: boolean;
};

export type RoryAlert = {
  kind: "camera" | "self-report" | "off-route" | "reroute-failed";
  /** Milliseconds since the epoch. */
  at: number;
  /** For a self-report, the state the driver gave, e.g. "Very Sleepy". */
  detail?: string;
};

export type RoryContext = {
  destinationName: string;
  positionKnown: boolean;
  remainingKm: number | null;
  remainingDriveMinutes: number | null;
  /** Planned rest still ahead, in minutes. */
  restMinutesAhead: number;
  eta: Date | null;
  next: RoryWaypoint | null;
  /** The next turn as a sentence ("In 350 metres, turn left onto ..."). */
  nextTurn: string | null;
  hasDirections: boolean;
  selfReport: { label: string; at: number; afterRest: boolean } | null;
  camera: { active: boolean; warnings: number; lastWarningAt: number | null };
  lastAlert: RoryAlert | null;
  now: number;
};

const CLOCK = new Intl.DateTimeFormat("en-AU", {
  hour: "numeric",
  minute: "2-digit",
});

/** "just now", "4 minutes ago", "about 2 hours ago". */
function ago(at: number, now: number): string {
  const minutes = Math.round((now - at) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60)
    return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  const hours = Math.round(minutes / 60);
  return `about ${hours} ${hours === 1 ? "hour" : "hours"} ago`;
}

function times(n: number): string {
  return n === 1 ? "once" : n === 2 ? "twice" : `${n} times`;
}

/** "toilets, lighting and water". */
function listOf(items: string[]): string {
  const lower = items.map((item) => item.toLowerCase());
  if (lower.length <= 1) return lower.join("");
  return `${lower.slice(0, -1).join(", ")} and ${lower[lower.length - 1]}`;
}

/*
 * The facility labels each spoken name stands for, from the rest area
 * data (backend/src/backend/rest_stops.py). An empty list means the data
 * does not record it at all.
 */
const FACILITY_LABELS: Record<string, { spoken: string; labels: string[] }> = {
  TOILETS: { spoken: "toilets", labels: ["Toilets", "Accessible toilet"] },
  SHOWERS: { spoken: "showers", labels: [] },
  WATER: { spoken: "drinking water", labels: ["Water"] },
  FOOD: { spoken: "food", labels: [] },
  LIGHTING: { spoken: "lighting", labels: ["Lighting"] },
  SHADE: { spoken: "shade", labels: ["Shade", "Shelter"] },
  SEATING: { spoken: "seating", labels: ["Seating"] },
  BIN: { spoken: "a bin", labels: ["Bin"] },
  BBQ: { spoken: "a barbecue", labels: ["BBQ"] },
  POWER: { spoken: "power", labels: ["Power"] },
};

const NO_MORE_STOPS = (c: RoryContext) =>
  `There are no more planned stops before ${c.destinationName}.`;

function distanceAnswer(c: RoryContext): string {
  if (!c.positionKnown || c.remainingKm === null) {
    return "I don't have your location yet, so I can't work out the distance.";
  }
  return `You have ${spokenDistance(c.remainingKm)} to go to ${c.destinationName}.`;
}

function timeAnswer(c: RoryContext): string {
  if (!c.positionKnown || c.remainingDriveMinutes === null || !c.eta) {
    return "I don't have your location yet, so I can't work out the time.";
  }
  const driving = `About ${spokenMinutes(c.remainingDriveMinutes)} of driving left.`;
  const arrival = `around ${CLOCK.format(c.eta)}`;
  return c.restMinutesAhead > 0
    ? `${driving} With ${spokenMinutes(c.restMinutesAhead)} of planned rest, you should reach ${c.destinationName} ${arrival}.`
    : `${driving} You should reach ${c.destinationName} ${arrival}.`;
}

function nextStopAnswer(c: RoryContext): string {
  const next = c.next;
  if (!next) return NO_MORE_STOPS(c);
  const where =
    next.distanceKm !== null
      ? `, ${spokenDistance(next.distanceKm)} ahead`
      : "";
  if (next.kind === "stop") {
    const rest =
      next.restMinutes !== null && next.restMinutes > 0
        ? ` You have ${spokenMinutes(next.restMinutes)} of rest planned there.`
        : "";
    return `Your next rest stop is ${next.name}${where}.${rest}`;
  }
  return next.isFinal
    ? `Your next stop is your destination, ${next.name}${where}.`
    : `Your next stop is ${next.name}${where}.`;
}

function fuelAnswer(c: RoryContext): string {
  const next = c.next;
  if (!next) return NO_MORE_STOPS(c);
  // The rest area data has no fuel field; "Fuel" is inferred from the
  // operator type (a service centre), so it is never stated as certain.
  return next.facilities.includes("Fuel")
    ? `${next.name} is a service centre, so fuel is likely there, but the rest area data can't confirm it.`
    : `Fuel isn't listed at ${next.name}. The rest area data doesn't record fuel reliably, so check before relying on it.`;
}

function facilitiesAnswer(c: RoryContext, facility: string | null): string {
  const next = c.next;
  if (!next) return NO_MORE_STOPS(c);
  if (facility && FACILITY_LABELS[facility]) {
    const { spoken, labels } = FACILITY_LABELS[facility];
    if (labels.length === 0) {
      return `The rest area data doesn't record ${spoken}, so I can't tell you about ${next.name}.`;
    }
    return labels.some((label) => next.facilities.includes(label))
      ? `Yes, ${next.name} has ${spoken}.`
      : `${spoken[0].toUpperCase()}${spoken.slice(1)} isn't listed for ${next.name}. The data isn't complete for every state, so it may still be there.`;
  }
  const listed = next.facilities.filter((label) => label !== "Fuel");
  return listed.length > 0
    ? `${next.name} lists ${listOf(listed)}.`
    : `No facilities are listed for ${next.name}.`;
}

function fatigueAnswer(c: RoryContext): string {
  const parts: string[] = [];
  if (c.selfReport) {
    const when = c.selfReport.afterRest
      ? "after your rest"
      : "before you set off";
    parts.push(
      `Your last state check, ${when}, ${ago(c.selfReport.at, c.now)}, said ${c.selfReport.label.toLowerCase()}.`,
    );
  } else {
    parts.push("You haven't done a state check on this trip.");
  }
  if (!c.camera.active) {
    parts.push("Camera monitoring is off.");
  } else if (c.camera.warnings > 0 && c.camera.lastWarningAt !== null) {
    parts.push(
      `The camera has warned you ${times(c.camera.warnings)}, most recently ${ago(c.camera.lastWarningAt, c.now)}.`,
    );
  } else {
    parts.push("The camera hasn't seen any signs of drowsiness.");
  }
  // Retrieval only: Rory repeats what the checks found and points to the
  // existing search; it does not rate the driver's fatigue itself.
  const concern =
    c.camera.warnings > 0 ||
    (c.selfReport !== null && !/not sleepy/i.test(c.selfReport.label));
  if (concern) {
    parts.push("If you feel tired, ask me to find a rest stop.");
  }
  return parts.join(" ");
}

function alertAnswer(c: RoryContext): string {
  const alert = c.lastAlert;
  if (!alert) return "There hasn't been a safety alert on this trip.";
  const when = ago(alert.at, c.now);
  switch (alert.kind) {
    case "camera":
      return `The last warning, ${when}, came from the camera check. Your eyes were closed for more than one and a half seconds, which can be a sign of drowsiness. If you're tired, stop when it's legal and safe.`;
    case "self-report":
      return `That reminder is because your state check said ${(alert.detail ?? "you were sleepy").toLowerCase()}. It stays until you dismiss it or do a new check.`;
    case "off-route":
      return `The last alert, ${when}, was because you left the planned truck route by more than 150 metres, so a new truck route was planned from where you were.`;
    case "reroute-failed":
      return `The last alert, ${when}, was because you were off the planned route and the routing service couldn't be reached, so the previous route is still shown.`;
  }
}

export const HELP_ANSWER =
  "I can tell you the distance and time left, your next stop, and fuel and facilities there. I can explain your safety alerts and tell you what your fatigue checks found. I can also find a rest stop, repeat the last direction, or end navigation.";

export const UNSUPPORTED_ANSWER =
  "Sorry, I can only help with this journey. Ask me about distance, time, your next stop, fuel, facilities, or your safety alerts.";

/**
 * The spoken answer to a question, or null for intents that are actions
 * (finding a stop, muting and so on), which the navigation page carries
 * out and answers itself.
 */
export function answerQuestion(
  intent: RoryIntent,
  facility: string | null,
  c: RoryContext,
): string | null {
  switch (intent) {
    case "distance":
      return distanceAnswer(c);
    case "time":
      return timeAnswer(c);
    case "next-stop":
      return nextStopAnswer(c);
    case "fuel":
      return fuelAnswer(c);
    case "facilities":
      return facilitiesAnswer(c, facility);
    case "next-turn":
      if (!c.hasDirections) {
        return "Turn by turn directions aren't available for this route. Follow the green line on the map.";
      }
      return (
        c.nextTurn ??
        `There are no more turns before ${c.next?.name ?? c.destinationName}.`
      );
    case "fatigue-status":
      return fatigueAnswer(c);
    case "alert-explain":
      return alertAnswer(c);
    case "help":
      return HELP_ANSWER;
    case "unsupported":
      return UNSUPPORTED_ANSWER;
    default:
      return null;
  }
}
