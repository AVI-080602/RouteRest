/**
 * What a driver meant, from one transcribed sentence.
 *
 * The speech engine (public/rory/rory-worker.js) turns every sentence
 * spoken in the cab into upper-case text with no punctuation, for example
 * "HEY RORY HOW FAR IS MY NEXT REST STOP". This file decides two things:
 *
 *   1. Was Rory being addressed? Only a sentence that starts with the
 *      wake phrase counts, so conversation in the cab, a phone call or the
 *      radio is ignored. The one exception is the short window after Rory
 *      asks a question ("Add it as your next stop?"), when "yes" or "no"
 *      on its own is accepted.
 *   2. Which of a fixed set of things the driver asked for. Rory is a
 *      journey assistant, not a chatbot (Epic 5 scope): anything outside
 *      the set is "unsupported" and Rory says what it can help with.
 *
 * Plain keyword rules rather than a language model, on purpose: every
 * answer comes from data the app already has, the rules can be read and
 * tested, and nothing leaves the phone. scripts/check-rory-intents.ts runs
 * every rule against sentences the engine actually produced in testing.
 *
 * Kept free of imports so that check script can load it with plain Node.
 */

export type RoryIntent =
  // Journey information (US 5.1)
  | "distance" // AC 5.1.2 remaining distance
  | "time" // AC 5.1.3 remaining travel time
  | "next-stop" // AC 5.1.4 next planned stop
  | "fuel" // AC 5.1.6 fuel information
  | "facilities" // AC 5.1.7 facility information
  | "next-turn"
  // Safety information (US 5.2)
  | "fatigue-status" // AC 5.2.1 fatigue alert information
  | "alert-explain" // AC 5.2.2 safety alert explanation
  // Hands-free control of the navigation screen
  | "find-rest-stop"
  | "dismiss"
  | "repeat"
  | "mute"
  | "unmute"
  | "reroute"
  | "arrived"
  | "end-navigation"
  | "camera-on"
  | "camera-off"
  | "help"
  // Answers to a question Rory asked
  | "confirm"
  | "decline"
  // AC 5.1.8 anything else
  | "unsupported";

export type ParsedSentence = {
  /** Rory was addressed: the wake phrase, or an answer Rory was waiting for. */
  addressed: boolean;
  /** The words after the wake phrase, upper case. Empty for "Hey Rory" alone. */
  command: string;
  intent: RoryIntent | null;
  /** For "facilities": the one the driver named, if any, e.g. "TOILETS". */
  facility: string | null;
};

/** Upper case words, apostrophes kept ("WHERE'S"), everything else dropped. */
export function words(text: string): string[] {
  return text
    .toUpperCase()
    .replace(/[^A-Z0-9' ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/*
 * The wake phrase. The engine spells a name it has never seen in many
 * ways: in testing "Hey Rory" came back as HEY RORY, HEYRORI, HEYROI,
 * HEORI, HE RORY, KRORI, PENRORY and AND HE RORY. So the first one to
 * three words are joined and matched against a pattern: an optional
 * greeting, then something that sounds like Rory.
 *
 * "Rory" on its own is accepted; the shorter sound-alikes (ROY, ROI, ORI)
 * are only accepted after a greeting, so a sentence that starts "Roy
 * called" does not wake Rory. Words like SORRY or STORY never match,
 * because the pattern must match from the first letter of the sentence.
 */
const GREETING = "(?:AND)?(?:HEY|HAY|HE|HI|A|AY|NAY|OK|OKAY|K|PEN)";
const FULL_NAME = "(?:R?ORY|RORI|RORIE|RORRY|ROARY|ROARIE|RAWRY|ROORY)";
const SHORT_NAME = "(?:ROI|ROY|ROE|ORI|ORIE|ROIE)";
const WAKE = new RegExp(
  `^(?:${GREETING}?${FULL_NAME}|${GREETING}${SHORT_NAME})$`,
);

/**
 * How many leading words are the wake phrase, or 0 when the sentence does
 * not start with one.
 */
export function wakeWordLength(tokens: string[]): number {
  for (let n = 1; n <= Math.min(3, tokens.length); n += 1) {
    if (WAKE.test(tokens.slice(0, n).join(""))) {
      return n;
    }
  }
  return 0;
}

/** Matches when any of the phrases occurs as whole words in the text. */
function has(text: string, ...phrases: string[]): boolean {
  return phrases.some((phrase) =>
    new RegExp(`(?:^| )${phrase}(?: |$)`).test(text),
  );
}

const END_NAVIGATION =
  /(?:^| )(?:END|AND|STOP|FINISH|CANCEL|EXIT|QUIT|CLOSE)(?: THE| MY)? (?:NAVIGATION|NAVIGATING|NAV|JOURNEY|TRIP|GUIDANCE)(?: |$)/;

/*
 * Facilities a driver might ask about. The key is what roryAnswers.ts
 * looks up; showers and food are understood but are not in the rest area
 * data, so Rory says so rather than guessing.
 */
const FACILITY_WORDS: Array<[string[], string]> = [
  [
    [
      "TOILET",
      "TOILETS",
      "LOO",
      "LOOS",
      "BATHROOM",
      "BATHROOMS",
      "DUNNY",
      "RESTROOM",
    ],
    "TOILETS",
  ],
  [["SHOWER", "SHOWERS"], "SHOWERS"],
  [["WATER", "DRINKING WATER"], "WATER"],
  [["FOOD", "CAFE", "COFFEE", "EAT", "MEAL", "RESTAURANT"], "FOOD"],
  [["LIGHT", "LIGHTS", "LIGHTING", "LIT"], "LIGHTING"],
  [["SHADE", "SHELTER"], "SHADE"],
  [["TABLE", "TABLES", "PICNIC", "SEAT", "SEATS", "SEATING"], "SEATING"],
  [["BIN", "BINS", "RUBBISH"], "BIN"],
  [["BBQ", "BARBECUE", "BARBIE"], "BBQ"],
  [["POWER", "POWER POINT", "CHARGE", "CHARGING"], "POWER"],
];

function namedFacility(text: string): string | null {
  for (const [spoken, facility] of FACILITY_WORDS) {
    if (has(text, ...spoken)) {
      return facility;
    }
  }
  return null;
}

/**
 * The intent of a command, the words after the wake phrase. The order of
 * the checks matters: "is there fuel at the next stop" is about fuel, not
 * the next stop, and "where is my next rest stop" is a question about the
 * plan, not a request to find a new stop.
 */
export function classify(command: string): {
  intent: RoryIntent;
  facility: string | null;
} {
  const t = words(command).join(" ");
  const result = (intent: RoryIntent, facility: string | null = null) => ({
    intent,
    facility,
  });

  if (!t) return result("help");

  // Controls first: short, distinctive phrases.
  if (
    has(
      t,
      "BE QUIET",
      "QUIET",
      "MUTE",
      "STOP TALKING",
      "SHUT UP",
      "SILENCE",
      "VOICE OFF",
      "SHUSH",
    )
  )
    return result("mute");
  if (has(t, "VOICE ON", "UNMUTE", "START TALKING", "TALK TO ME", "SOUND ON"))
    return result("unmute");
  if (
    has(
      t,
      "REPEAT",
      "SAY THAT AGAIN",
      "SAY IT AGAIN",
      "SAY AGAIN",
      "COME AGAIN",
      "PARDON",
      "WHAT DID YOU SAY",
    )
  )
    return result("repeat");
  // The verb must sit right next to the noun: "how far and how long is my
  // trip" contains AND and TRIP but is not a request to stop. ("AND" is
  // here because the engine hears "end navigation" as "and navigation".)
  if (END_NAVIGATION.test(t)) return result("end-navigation");
  if (has(t, "CAMERA") && has(t, "OFF", "STOP", "DISABLE"))
    return result("camera-off");
  if (has(t, "CAMERA") && has(t, "ON", "START", "ENABLE"))
    return result("camera-on");
  if (
    has(
      t,
      "I'VE ARRIVED",
      "I HAVE ARRIVED",
      "WE'VE ARRIVED",
      "ARRIVED",
      "I'M HERE",
      "WE'RE HERE",
      "I AM HERE",
    )
  )
    return result("arrived");
  if (
    has(
      t,
      "DISMISS",
      "GOT IT",
      "ACKNOWLEDGE",
      "CLEAR THE ALERT",
      "CLEAR THE WARNING",
      "I'M OKAY",
      "I'M OK",
      "I AM OKAY",
    )
  )
    return result("dismiss");
  if (
    has(
      t,
      "REPLAN",
      "RE PLAN",
      "REROUTE",
      "RE ROUTE",
      "NEW ROUTE",
      "RECALCULATE",
      "PLAN A ROUTE",
    )
  )
    return result("reroute");

  // A driver saying they are tired wants somewhere to stop, not a report.
  if (
    has(
      t,
      "I'M TIRED",
      "I AM TIRED",
      "I'M SLEEPY",
      "I AM SLEEPY",
      "I NEED A BREAK",
      "I NEED A REST",
      "I NEED A NAP",
    )
  )
    return result("find-rest-stop");

  // Safety information.
  if (
    has(t, "WHY") ||
    has(t, "EXPLAIN") ||
    has(t, "WHAT WAS THAT", "WHAT'S THAT")
  )
    return result("alert-explain");
  if (
    has(
      t,
      "TIRED",
      "FATIGUE",
      "FATIGUED",
      "SLEEPY",
      "DROWSY",
      "ALERTNESS",
      "HOW AM I DOING",
      "MY STATE",
      "STATE CHECK",
    ) &&
    !has(t, "FIND", "NEED", "WANT")
  )
    return result("fatigue-status");

  // Journey information. Fuel and facilities before "next stop".
  if (
    has(
      t,
      "FUEL",
      "DIESEL",
      "PETROL",
      "SERVO",
      "SERVICE STATION",
      "FILL UP",
      "REFUEL",
      "GAS",
    )
  )
    return result("fuel");
  const facility = namedFacility(t);
  if (
    facility ||
    has(
      t,
      "FACILITIES",
      "FACILITY",
      "AMENITIES",
      "WHAT'S THERE",
      "WHAT IS THERE",
    )
  )
    return result("facilities", facility);
  if (
    has(
      t,
      "NEXT TURN",
      "WHERE DO I TURN",
      "WHICH WAY",
      "DIRECTIONS",
      "WHAT'S NEXT",
      "NEXT INSTRUCTION",
    )
  )
    return result("next-turn");

  // "Find me a rest stop" against "where is my next rest stop".
  const asksAboutPlan = has(
    t,
    "WHERE",
    "WHERE'S",
    "WHEN",
    "WHEN'S",
    "HOW FAR",
    "HOW LONG",
    "NEXT",
    "WHAT'S MY",
    "WHAT IS MY",
  );
  if (
    !asksAboutPlan &&
    (has(
      t,
      "FIND",
      "NEED",
      "WANT",
      "LOOKING FOR",
      "GET ME",
      "SHOW ME",
      "TAKE ME",
    ) ||
      has(t, "I'M TIRED", "I AM TIRED"))
  )
    return result("find-rest-stop");
  if (
    has(
      t,
      "NEXT STOP",
      "NEXT REST",
      "NEXT BREAK",
      "NEXT REST STOP",
      "NEXT REST AREA",
    ) ||
    (has(t, "WHERE", "WHERE'S", "WHEN", "WHEN'S") &&
      has(t, "STOP", "BREAK", "REST", "PARK"))
  )
    return result("next-stop");
  if (
    has(
      t,
      "HOW LONG",
      "TIME LEFT",
      "TIME REMAINING",
      "WHEN WILL I",
      "WHEN DO I",
      "WHAT TIME",
      "ARRIVAL",
      "ARRIVE",
      "ETA",
      "DRIVING TIME",
    )
  )
    return result("time");
  if (
    has(
      t,
      "HOW FAR",
      "DISTANCE",
      "KILOMETRES",
      "KILOMETERS",
      "KAYS",
      "MILES",
      "LEFT TO GO",
      "HOW MUCH FURTHER",
      "HOW MUCH FARTHER",
    )
  )
    return result("distance");
  if (has(t, "HELP", "WHAT CAN YOU DO", "WHAT CAN I ASK", "WHAT CAN I SAY"))
    return result("help");
  if (
    has(t, "FIND", "NEED", "WANT") &&
    has(t, "REST", "STOP", "BREAK", "PARK", "SLEEP")
  )
    return result("find-rest-stop");

  return result("unsupported");
}

const YES = [
  "YES",
  "YEAH",
  "YEP",
  "YUP",
  "YA",
  "SURE",
  "OK",
  "OKAY",
  "DO IT",
  "GO AHEAD",
  "ADD IT",
  "PLEASE",
  "CORRECT",
  "AFFIRMATIVE",
];
const NO = [
  "NO",
  "NOPE",
  "NAH",
  "CANCEL",
  "DON'T",
  "NEVER MIND",
  "NOT NOW",
  "LEAVE IT",
  "KEEP IT",
];

/** A yes or no at the start of an answer to Rory's question. */
export function yesOrNo(command: string): "confirm" | "decline" | null {
  const tokens = words(command);
  const start = tokens.slice(0, 3).join(" ");
  // "No" wins over "okay" in "no okay leave it".
  if (NO.some((w) => new RegExp(`^${w}(?: |$)`).test(start))) return "decline";
  if (YES.some((w) => new RegExp(`^${w}(?: |$)`).test(start))) return "confirm";
  return null;
}

/**
 * The whole decision for one sentence.
 *
 * `expecting` says what Rory is waiting for, if anything:
 *   "command": Rory heard "Hey Rory" on its own and said "Yes?", so the
 *              next sentence is taken as a command without the wake phrase.
 *   "answer":  Rory asked a yes or no question.
 */
export function parseSentence(
  text: string,
  expecting: "command" | "answer" | null = null,
): ParsedSentence {
  const tokens = words(text);
  const wake = wakeWordLength(tokens);
  const command = tokens.slice(wake).join(" ");

  if (wake === 0) {
    if (expecting === "answer") {
      const answer = yesOrNo(command);
      if (answer) {
        return { addressed: true, command, intent: answer, facility: null };
      }
    }
    if (expecting === "command" && command) {
      const { intent, facility } = classify(command);
      return { addressed: true, command, intent, facility };
    }
    return { addressed: false, command, intent: null, facility: null };
  }

  if (!command) {
    return { addressed: true, command: "", intent: null, facility: null };
  }
  if (expecting === "answer") {
    const answer = yesOrNo(command);
    if (answer) {
      return { addressed: true, command, intent: answer, facility: null };
    }
  }
  const { intent, facility } = classify(command);
  return { addressed: true, command, intent, facility };
}
