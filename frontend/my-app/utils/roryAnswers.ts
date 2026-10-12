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
import type { RoryIntent, RorySubject } from "./roryIntents";

export type RoryWaypoint = {
  kind: "departure" | "stop" | "destination";
  name: string;
  /** Along-route distance from the truck, when the position is known. */
  distanceKm: number | null;
  /** Driving time to it at the plan's average pace, when known. */
  minutesAway: number | null;
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
  /** How far along the route the truck is, when the position is known. */
  alongKm: number | null;
  /** The whole route, as planned. */
  totalKm: number;
  totalDriveMinutes: number;
  /** Planned rest still ahead, in minutes. */
  restMinutesAhead: number;
  eta: Date | null;
  next: RoryWaypoint | null;
  /** The stop after `next`, for "and after that?". */
  after: RoryWaypoint | null;
  /** The last waypoint passed, for "where am I". */
  previous: { name: string; kind: RoryWaypoint["kind"] } | null;
  /**
   * Planned rest stops still ahead, in order, with their rest minutes,
   * facilities and along-route distance (null without a position).
   */
  stopsAhead: Array<{
    name: string;
    restMinutes: number | null;
    facilities: string[];
    distanceKm: number | null;
  }>;
  /** Destinations still ahead, counting the final one. */
  destinationsAhead: number;
  speedKmh: number | null;
  /** Minutes since navigation started, when known. */
  navigationMinutes: number | null;
  offRoute: boolean;
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

const DAY = new Intl.DateTimeFormat("en-AU", {
  weekday: "long",
  day: "numeric",
  month: "long",
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

/** "Glenrowan, Wangaratta and Wodonga": names keep their capitals. */
function joinNames(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** "toilets, lighting and water". */
function listOf(items: string[]): string {
  return joinNames(items.map((item) => item.toLowerCase()));
}

/** "Glenrowan, 42 kilometres and about 30 minutes ahead". */
function whereIs(w: RoryWaypoint): string {
  const parts: string[] = [];
  if (w.distanceKm !== null) parts.push(spokenDistance(w.distanceKm));
  if (w.minutesAway !== null)
    parts.push(`about ${spokenMinutes(w.minutesAway)}`);
  return parts.length > 0 ? `${w.name}, ${parts.join(" and ")} ahead` : w.name;
}

/*
 * The facility labels each spoken name stands for, from the rest area
 * data (backend/src/backend/rest_stops.py). An empty list means the data
 * does not record it at all.
 */
export const FACILITY_LABELS: Record<
  string,
  { spoken: string; labels: string[] }
> = {
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

/** The stop a question is about, or null with the reason already said. */
function stopFor(c: RoryContext, subject: RorySubject): RoryWaypoint | null {
  return subject === "after" ? c.after : c.next;
}

function noStop(c: RoryContext, subject: RorySubject): string {
  if (subject === "after" && c.next) {
    return c.next.isFinal
      ? `${c.next.name} is your destination, so there's nothing after it.`
      : `After ${c.next.name} there are no more planned stops before ${c.destinationName}.`;
  }
  return NO_MORE_STOPS(c);
}

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

function nextStopAnswer(c: RoryContext, subject: RorySubject): string {
  const stop = stopFor(c, subject);
  if (!stop) return noStop(c, subject);
  const lead =
    subject === "after" && c.next ? `After ${c.next.name}, your` : "Your";
  if (stop.kind === "stop") {
    const rest =
      stop.restMinutes !== null && stop.restMinutes > 0
        ? ` You have ${spokenMinutes(stop.restMinutes)} of rest planned there.`
        : "";
    return `${lead} next rest stop is ${whereIs(stop)}.${rest}`;
  }
  return stop.isFinal
    ? `${lead} next stop is your destination, ${whereIs(stop)}.`
    : `${lead} next stop is ${whereIs(stop)}.`;
}

function nextBreakTimeAnswer(c: RoryContext, subject: RorySubject): string {
  const stop = stopFor(c, subject);
  if (!stop) return noStop(c, subject);
  if (stop.distanceKm === null) {
    return `I don't have your location yet. ${subject === "after" ? "The stop after next" : "Your next stop"} is ${stop.name}.`;
  }
  const when =
    stop.minutesAway !== null && c.now
      ? `, around ${CLOCK.format(new Date(c.now + stop.minutesAway * 60000))}`
      : "";
  const what =
    stop.kind === "stop" ? "rest stop" : stop.isFinal ? "destination" : "stop";
  const rest =
    stop.kind === "stop" && stop.restMinutes
      ? ` You'll have ${spokenMinutes(stop.restMinutes)} there.`
      : "";
  return `${subject === "after" ? "The stop after next" : `Your next ${what}`}, ${stop.name}, is ${spokenDistance(stop.distanceKm)} away${
    stop.minutesAway !== null
      ? `, about ${spokenMinutes(stop.minutesAway)} of driving`
      : ""
  }${when}.${rest}`;
}

function stopsRemainingAnswer(c: RoryContext): string {
  const n = c.stopsAhead.length;
  if (n === 0) {
    return c.destinationsAhead > 1
      ? `No more rest stops are planned, but you have ${c.destinationsAhead} destinations still to reach, ending at ${c.destinationName}.`
      : NO_MORE_STOPS(c);
  }
  const names = joinNames(c.stopsAhead.map((s) => s.name));
  const rest =
    c.restMinutesAhead > 0
      ? ` That's ${spokenMinutes(c.restMinutesAhead)} of planned rest in total.`
      : "";
  return `${n === 1 ? "One rest stop is" : `${n} rest stops are`} still planned before ${c.destinationName}: ${names}.${rest}`;
}

function restAheadAnswer(c: RoryContext, subject: RorySubject): string {
  const stop = stopFor(c, subject);
  if (c.stopsAhead.length === 0) return NO_MORE_STOPS(c);
  const total = `You have ${spokenMinutes(c.restMinutesAhead)} of planned rest left, over ${c.stopsAhead.length === 1 ? "one stop" : `${c.stopsAhead.length} stops`}.`;
  if (stop && stop.kind === "stop" && stop.restMinutes) {
    return `${subject === "after" ? "The stop after next" : "Your next stop"}, ${stop.name}, has ${spokenMinutes(stop.restMinutes)} of rest planned. ${total}`;
  }
  return total;
}

function fuelAnswer(
  c: RoryContext,
  subject: RorySubject,
  topic: string | null,
): string {
  const stop = stopFor(c, subject);
  // The rest area data has no fuel field; "Fuel" is inferred from the
  // operator type (a service centre), so it is never stated as certain.
  // When the stop asked about has none, the rest of the plan is checked
  // before pointing the driver to the search.
  const laterFuel =
    subject === "next"
      ? c.stopsAhead.find(
          (s) => s.facilities.includes("Fuel") && s.name !== stop?.name,
        )
      : undefined;
  const elsewhere = laterFuel
    ? ` The first planned stop with likely fuel is ${laterFuel.name}${
        laterFuel.distanceKm !== null
          ? `, ${spokenDistance(laterFuel.distanceKm)} ahead`
          : ""
      }.`
    : " None of your other planned stops list fuel either. Ask me to find fuel and I'll look for the nearest fuel station.";
  const where = stop
    ? stop.facilities.includes("Fuel")
      ? `${stop.name} is a service centre, so fuel is likely there, but the rest area data can't confirm it.`
      : `Fuel isn't listed at ${stop.name}.${subject === "next" ? elsewhere : " Ask me to find fuel and I'll look for the nearest fuel station."}`
    : `${noStop(c, subject)} Ask me to find fuel and I'll look for the nearest fuel station.`;
  if (topic === "level") {
    // Rory cannot see the gauge: the phone has no link to the truck.
    return `I can't see your fuel gauge, so I can't tell how much you have left. ${where}`;
  }
  return where;
}

function facilitiesAnswer(
  c: RoryContext,
  subject: RorySubject,
  facility: string | null,
): string {
  const stop = stopFor(c, subject);
  if (!stop) return noStop(c, subject);
  if (facility && FACILITY_LABELS[facility]) {
    const { spoken, labels } = FACILITY_LABELS[facility];
    if (labels.length === 0) {
      return `The rest area data doesn't record ${spoken}, so I can't tell you about ${stop.name}.`;
    }
    return labels.some((label) => stop.facilities.includes(label))
      ? `Yes, ${stop.name} has ${spoken}.`
      : `${spoken[0].toUpperCase()}${spoken.slice(1)} isn't listed for ${stop.name}. The data isn't complete for every state, so it may still be there.`;
  }
  const listed = stop.facilities.filter((label) => label !== "Fuel");
  return listed.length > 0
    ? `${stop.name} lists ${listOf(listed)}.`
    : `No facilities are listed for ${stop.name}.`;
}

function destinationAnswer(c: RoryContext): string {
  const far =
    c.positionKnown && c.remainingKm !== null
      ? `, ${spokenDistance(c.remainingKm)} away`
      : "";
  const via =
    c.stopsAhead.length > 0
      ? ` with ${c.stopsAhead.length === 1 ? "one rest stop" : `${c.stopsAhead.length} rest stops`} on the way`
      : "";
  const eta = c.eta
    ? `. You should get there around ${CLOCK.format(c.eta)}`
    : "";
  return `You're heading to ${c.destinationName}${far}${via}${eta}.`;
}

function whereAmIAnswer(c: RoryContext): string {
  if (!c.positionKnown || c.alongKm === null) {
    return "I don't have your location yet.";
  }
  const parts: string[] = [];
  if (c.offRoute) {
    parts.push("You're off the planned route, and a new one is being planned.");
  } else {
    parts.push("You're on the planned route.");
  }
  if (c.previous) {
    parts.push(
      `You're ${spokenDistance(c.alongKm)} into the trip, past ${c.previous.name}.`,
    );
  } else {
    parts.push(`You're ${spokenDistance(c.alongKm)} into the trip.`);
  }
  if (c.next && c.next.distanceKm !== null) {
    parts.push(`${c.next.name} is ${spokenDistance(c.next.distanceKm)} ahead.`);
  }
  return parts.join(" ");
}

function speedAnswer(c: RoryContext): string {
  if (!c.positionKnown || c.speedKmh === null) {
    return "I can't tell your speed yet. It comes from the phone's location, which needs a few seconds of movement.";
  }
  const rounded = Math.round(c.speedKmh);
  if (rounded < 3) return "You're stationary at the moment.";
  // Rory never knows the limit, so it never says whether this is too fast.
  return `You're doing about ${rounded} kilometres an hour, as far as the phone can tell. I don't know the speed limit here.`;
}

function drivingDurationAnswer(c: RoryContext): string {
  if (c.navigationMinutes === null) {
    return "I don't know when this trip started.";
  }
  const started = CLOCK.format(new Date(c.now - c.navigationMinutes * 60000));
  return `Navigation has been running for ${spokenMinutes(c.navigationMinutes)}, since about ${started}. That includes any rest you've taken.`;
}

function currentTimeAnswer(c: RoryContext, command: string): string {
  const now = new Date(c.now);
  if (/\b(DAY|DATE)\b/.test(command.toUpperCase())) {
    return `It's ${DAY.format(now)}, ${CLOCK.format(now)}.`;
  }
  return `It's ${CLOCK.format(now)}.`;
}

function tripSummaryAnswer(c: RoryContext): string {
  const whole = `The whole trip is ${spokenDistance(c.totalKm)}, about ${spokenMinutes(c.totalDriveMinutes)} of driving, with ${
    c.stopsAhead.length === 1
      ? "one rest stop"
      : `${c.stopsAhead.length} rest stops`
  } still planned.`;
  if (
    !c.positionKnown ||
    c.remainingKm === null ||
    c.remainingDriveMinutes === null
  ) {
    return whole;
  }
  return `${whole} You have ${spokenDistance(c.remainingKm)} and about ${spokenMinutes(c.remainingDriveMinutes)} of driving left to ${c.destinationName}.`;
}

function restRuleAnswer(c: RoryContext): string {
  // Retrieval only: the plan already applied the work and rest rules.
  // Rory repeats where the plan says to stop; it never extends a limit.
  const next = c.stopsAhead[0];
  if (!next) {
    return `Your plan has no more required breaks before ${c.destinationName}. If you feel tired before then, stop anyway: ask me to find a rest stop.`;
  }
  const where =
    c.next && c.next.kind === "stop" ? `${whereIs(c.next)}` : next.name;
  return `Your plan follows the work and rest rules for your route. The next required break is at ${where}${
    next.restMinutes ? `, for ${spokenMinutes(next.restMinutes)}` : ""
  }. Stop earlier if you feel tired; I can't extend a limit.`;
}

function cameraStatusAnswer(c: RoryContext): string {
  if (!c.camera.active) {
    return "Camera monitoring is off. Say turn the camera on if you'd like it watching for closed eyes. It works in daylight.";
  }
  return c.camera.warnings > 0 && c.camera.lastWarningAt !== null
    ? `Camera monitoring is on. It has warned you ${times(c.camera.warnings)}, most recently ${ago(c.camera.lastWarningAt, c.now)}.`
    : "Camera monitoring is on and hasn't seen any signs of drowsiness.";
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

/*
 * Topics drivers ask about that RouteRest has no data for. Naming the
 * topic, and what Rory can do instead, is more useful than a generic no.
 */
const UNAVAILABLE: Record<string, string> = {
  weather:
    "I don't have weather information. I can tell you about your route, your stops and your rest.",
  traffic:
    "I don't have traffic or road closure information. If you leave the planned route, I'll plan a new truck route from where you are.",
  "road-info":
    "I don't know speed limits, cameras or checkpoints. I only know your route and your rest plan.",
  music:
    "I can't play music or control the radio. I only help with your journey.",
  calls: "I can't make calls or send messages. I only help with your journey.",
  prices:
    "I don't know prices or tolls. I can tell you where fuel is likely on your route.",
  entertainment:
    "I'm not much of an entertainer. I can tell you about your next stop, your time left, or your safety alerts.",
  news: "I don't have news or scores. I only help with your journey.",
  load: "I don't know anything about your load or deliveries. I only know your route and your rest plan.",
};

const GREETINGS: Record<string, string> = {
  hello:
    "Hi. Ask me about your next stop, your time left, or your safety alerts.",
  morning: "Good morning. Safe driving. Ask me whenever you need something.",
  afternoon: "Good afternoon. Ask me whenever you need something.",
  evening:
    "Good evening. It's a tiring time of day to drive, so I'll keep an eye on your breaks.",
  bye: "Bye for now. I'm still listening if you need me.",
  "how-are-you":
    "I'm good, thanks. Keeping an eye on your trip. How are you feeling?",
};

export const HELP_ANSWER =
  "I can tell you how far and how long is left, your next stop and the one after, what fuel and facilities are there, how many stops remain, and when your next break is. I can explain your safety alerts and tell you what your fatigue checks found. I can also find a rest stop or the nearest fuel, repeat the last direction, turn the camera on or off, or end navigation. After I answer, you can ask a follow-up straight away without saying my name.";

export const IDENTITY_ANSWER =
  "I'm Rory, RouteRest's voice assistant. I listen on this phone for Hey Rory, and I answer from your route and rest plan. Nothing you say leaves the phone.";

/** The generic fallback, with what was heard so the driver can rephrase. */
export function unsupportedAnswer(heard: string): string {
  const quoted = heard.trim().toLowerCase();
  return quoted
    ? `I heard "${quoted}", but I'm not sure what you're asking. You can ask about your next stop, fuel, facilities, distance, time, or your safety alerts.`
    : "I'm not sure what you're asking. You can ask about your next stop, fuel, facilities, distance, time, or your safety alerts.";
}

export type RoryQuestion = {
  intent: RoryIntent;
  facility: string | null;
  topic: string | null;
  subject: RorySubject;
  /** The words after the wake phrase, for reading back in the fallback. */
  command: string;
};

/**
 * The spoken answer to a question, or null for intents that are actions
 * (finding a stop, muting and so on), which the navigation page carries
 * out and answers itself.
 */
export function answerQuestion(q: RoryQuestion, c: RoryContext): string | null {
  switch (q.intent) {
    case "distance":
      return distanceAnswer(c);
    case "time":
      return timeAnswer(c);
    case "next-stop":
      return nextStopAnswer(c, q.subject);
    case "next-break-time":
      return nextBreakTimeAnswer(c, q.subject);
    case "stops-remaining":
      return stopsRemainingAnswer(c);
    case "rest-ahead":
      return restAheadAnswer(c, q.subject);
    case "fuel":
      return fuelAnswer(c, q.subject, q.topic);
    case "facilities":
      return facilitiesAnswer(c, q.subject, q.facility);
    case "next-turn":
      if (!c.hasDirections) {
        return "Turn by turn directions aren't available for this route. Follow the green line on the map.";
      }
      return (
        c.nextTurn ??
        `There are no more turns before ${c.next?.name ?? c.destinationName}.`
      );
    case "destination":
      return destinationAnswer(c);
    case "where-am-i":
      return whereAmIAnswer(c);
    case "speed":
      return speedAnswer(c);
    case "driving-duration":
      return drivingDurationAnswer(c);
    case "current-time":
      return currentTimeAnswer(c, q.command);
    case "trip-summary":
      return tripSummaryAnswer(c);
    case "rest-rule":
      return restRuleAnswer(c);
    case "fatigue-status":
      return fatigueAnswer(c);
    case "alert-explain":
      return alertAnswer(c);
    case "camera-status":
      return cameraStatusAnswer(c);
    case "help":
      return HELP_ANSWER;
    case "identity":
      return IDENTITY_ANSWER;
    case "greeting":
      return GREETINGS[q.topic ?? "hello"] ?? GREETINGS.hello;
    case "thanks":
      return "No worries. Safe driving.";
    case "nevermind":
      return "Okay.";
    case "unavailable":
      return UNAVAILABLE[q.topic ?? ""] ?? unsupportedAnswer(q.command);
    case "unsupported":
      return unsupportedAnswer(q.command);
    default:
      return null;
  }
}
