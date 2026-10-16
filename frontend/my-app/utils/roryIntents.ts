/**
 * What a driver meant, from one transcribed sentence.
 *
 * The speech engine (public/rory/rory-worker.js) turns every sentence
 * spoken in the cab into upper-case text with no punctuation, for example
 * "HEY RORY HOW FAR IS MY NEXT REST STOP". This file decides three things:
 *
 *   1. Was Rory being addressed? A sentence that starts with the wake
 *      phrase always counts. Cab conversation, a phone call or the radio
 *      is ignored. Two exceptions keep a conversation flowing without
 *      "Hey Rory" every time: the short window after Rory asks a question
 *      ("Add it as your next stop?"), when "yes" or "no" on its own is
 *      accepted, and the twenty seconds after Rory answers, when a follow-up
 *      question ("and does it have fuel?") is accepted. Only questions are
 *      accepted that way; anything that changes the journey (ending
 *      navigation, re-routing, the camera) still needs the wake phrase.
 *   2. Which of a fixed set of things the driver asked for. Rory is a
 *      journey assistant, not a chatbot (Epic 5 scope): anything outside
 *      the set is "unsupported" and Rory says what it heard and what it
 *      can help with, or "unavailable" when it is a known topic (weather,
 *      traffic, music) that RouteRest has no data for.
 *   3. Which stop the question is about: the next one, or the one after
 *      ("and after that?").
 *
 * Plain keyword rules rather than a language model, on purpose: every
 * answer comes from data the app already has, the rules can be read and
 * tested, and nothing leaves the phone. The engine mishears words in
 * predictable ways ("fuel" as "few" or "feel", "stop" as "stopped"), so
 * sentences are normalised before the rules run. scripts/check-rory-intents.mjs
 * runs every rule against sentences the engine actually produced.
 *
 * Kept free of imports so that check script can load it with plain Node.
 */

export type RoryIntent =
  // Journey information (US 5.1)
  | "distance" // AC 5.1.2 remaining distance
  | "time" // AC 5.1.3 remaining travel time
  | "next-stop" // AC 5.1.4 next planned stop
  | "next-break-time" // when the next stop is reached
  | "stops-remaining" // how many stops are still planned
  | "rest-ahead" // how much planned rest is left
  | "fuel" // AC 5.1.6 fuel information
  | "facilities" // AC 5.1.7 facility information
  | "next-turn"
  | "destination"
  | "where-am-i"
  | "speed"
  | "driving-duration"
  | "current-time"
  | "trip-summary"
  | "rest-rule" // how long the plan lets the driver go before resting
  // Safety information (US 5.2)
  | "fatigue-status" // AC 5.2.1 fatigue alert information
  | "alert-explain" // AC 5.2.2 safety alert explanation
  | "camera-status"
  // Hands-free control of the navigation screen
  | "find-rest-stop"
  | "find-fuel" // search nearby for a stop where fuel is likely
  | "reorder-stops" // "fuel first", "swap the stops"; see `topic`
  | "dismiss"
  | "repeat"
  | "hush" // stop talking now; voice stays on
  | "mute"
  | "unmute"
  | "reroute"
  | "arrived"
  | "end-navigation"
  | "camera-on"
  | "camera-off"
  | "help"
  // Conversation
  | "greeting"
  | "thanks"
  | "identity"
  | "nevermind"
  | "unavailable" // a known topic RouteRest has no data for; see `topic`
  // Answers to a question Rory asked
  | "confirm"
  | "decline"
  // AC 5.1.8 anything else
  | "unsupported";

/** Which planned stop a question is about. */
export type RorySubject = "next" | "after";

export type ParsedSentence = {
  /** Rory was addressed: the wake phrase, or an answer Rory was waiting for. */
  addressed: boolean;
  /** The words after the wake phrase, upper case. Empty for "Hey Rory" alone. */
  command: string;
  intent: RoryIntent | null;
  /** For "facilities": the one the driver named, if any, e.g. "TOILETS". */
  facility: string | null;
  /**
   * Extra detail for some intents: the topic of an "unavailable" question
   * ("weather"), the kind of greeting ("morning"), or "level" for a fuel
   * gauge question.
   */
  topic: string | null;
  subject: RorySubject;
};

/**
 * What Rory is waiting for, if anything:
 *   "command":   Rory heard "Hey Rory" on its own and said "Yes?", so the
 *                next sentence is taken as a command without the wake phrase.
 *   "answer":    Rory asked a yes or no question.
 *   "follow-up": Rory just answered a question, so a question without the
 *                wake phrase is accepted for a few seconds.
 */
export type RoryExpecting = "command" | "answer" | "follow-up";

/** What Rory last answered, so "how far is it?" knows what "it" is. */
export type RoryLast = { intent: RoryIntent; subject: RorySubject };

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
// HELLO added 17 October 2026: in a driver's own test video the engine
// heard "HELLO RORY" and "HELLO RODY" as often as "HEY RORY".
const GREETING =
  "(?:AND)?(?:HEY|HAY|HE|HI|A|AY|NAY|OK|OKAY|K|PEN|HELLO|HALLO|HULLO|HELO)";
/*
 * 16 October 2026: a driver called Rory 14 times without an answer, and
 * testing with recorded Indian, Australian, British and American voices
 * showed why. The engine often hears the name right but the greeting as
 * AH, YEAH or KAY ("YEAH RORY HOW MUCH DRIVING TIME IS LEFT"), and with
 * some accents hears the name as RODY or RODRI. These softer greetings are
 * accepted only before the full name, never before ROY or ROI, so "Yeah,
 * Roy said" stays ordinary talk.
 */
const SOFT_GREETING = "(?:AH|YEAH|YEA|YA|KAY|OH|EH|HA)";
const FULL_NAME =
  "(?:R?ORY|RORI|RORIE|RORRY|ROARY|ROARIE|RAWRY|ROORY|RODY|RODIE|RODRI|RODRY)";
// Also accepted only after a greeting. RUDY is how the same video heard
// "Hey Rory" once; on its own it is a person's name, so "Rudy called"
// stays ordinary talk.
const SHORT_NAME = "(?:ROI|ROY|ROE|ORI|ORIE|ROIE|RUDY|RUDIE)";
// "Hey Ro..." run together into a single non-word, as the driver heard it.
const RUN_TOGETHER = "(?:HURO|HUROO|HURORY|HURORI)";
const WAKE = new RegExp(
  `^(?:(?:${GREETING}|${SOFT_GREETING})?${FULL_NAME}|${GREETING}${SHORT_NAME}|${RUN_TOGETHER})$`,
);
/*
 * Mishearings that are ordinary words ("HEY ABOUT", "YEAH ROLL"). They
 * wake Rory only when they are the whole sentence: the driver says "Hey
 * Rory" and waits, and Rory answers "Yes?". With more words after them,
 * as in "hey, about the next stop", they are ordinary talk.
 */
const WAKE_ALONE = new RegExp(
  `^(?:${GREETING}|${SOFT_GREETING})(?:ABOUT|ROLL|ROLE)$`,
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
  if (tokens.length <= 3 && WAKE_ALONE.test(tokens.join(""))) {
    return tokens.length;
  }
  return 0;
}

/**
 * Drops the app's own voice from a sentence heard while the app was
 * talking. Phones cancel the speaker from the microphone, but not always
 * completely, so the engine can transcribe a hint such as "Say Hey Rory,
 * find a rest stop" and wake Rory with it, or glue the tail of an answer
 * onto the driver's question ("...KILOMETRES AHEAD HEY RORY HOW FAR").
 *
 * `appText` is what the app said during the sentence. Returns the driver's
 * words, or null when the whole sentence is the app's own voice. The page
 * only calls this for sentences that overlapped the app talking, so a
 * driver repeating a hint after it has finished is still heard.
 */
export function stripEcho(tokens: string[], appText: string): string[] | null {
  const appWords = words(appText);
  if (appWords.length === 0 || tokens.length < 3) {
    return tokens;
  }
  // An echo repeats the app's words in the app's order, with the odd word
  // garbled; a question merely shares a few words with the answer. So
  // the test is how much of the sentence is an in-order match (longest
  // common subsequence), not how many words happen to be shared.
  const share = (list: string[]) =>
    inOrderMatches(list, appWords) / list.length;

  if (share(tokens) >= 0.7) {
    return null;
  }
  if (wakeWordLength(tokens) > 0) {
    return tokens;
  }
  // The app's words, then the driver's "Hey Rory ...": keep the driver's.
  for (let i = 2; i < tokens.length; i += 1) {
    if (
      wakeWordLength(tokens.slice(i)) > 0 &&
      share(tokens.slice(0, i)) >= 0.6
    ) {
      return tokens.slice(i);
    }
  }
  return tokens;
}

/** Length of the longest common subsequence of the two word lists. */
function inOrderMatches(a: string[], b: string[]): number {
  let previous = new Array<number>(b.length + 1).fill(0);
  for (const word of a) {
    const row = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j += 1) {
      row[j] =
        word === b[j - 1]
          ? previous[j - 1] + 1
          : Math.max(previous[j], row[j - 1]);
    }
    previous = row;
  }
  return previous[b.length];
}

/** Matches when any of the phrases occurs as whole words in the text. */
function has(text: string, ...phrases: string[]): boolean {
  return phrases.some((phrase) =>
    new RegExp(`(?:^| )${phrase}(?: |$)`).test(text),
  );
}

/** Matches when the text is one of the phrases, allowing a name after it. */
function whole(text: string, ...phrases: string[]): boolean {
  const bare = text.replace(/ (?:RORY|MATE|BUDDY|PLEASE)$/, "");
  return phrases.includes(bare);
}

/*
 * The engine's predictable mishearings, corrected before any rule runs.
 * Each is only applied where the misheard word sits next to a journey
 * word, so "I feel tired" keeps its meaning while "the next feel stop"
 * becomes "the next fuel stop". Every entry came from a transcript.
 */
const SOUND_ALIKES: Array<[RegExp, string]> = [
  // Contractions the engine writes without the apostrophe.
  [/\bWHATS\b/g, "WHAT'S"],
  [/\bWHERES\b/g, "WHERE'S"],
  [/\bWHENS\b/g, "WHEN'S"],
  [/\bHOWS\b/g, "HOW'S"],
  [/\bIM\b/g, "I'M"],
  [/\bIVE\b/g, "I'VE"],
  [/\bDONT\b/g, "DON'T"],
  [/\bCANT\b/g, "CAN'T"],
  [/\bTHATS\b/g, "THAT'S"],
  [/\bTHERES\b/g, "THERE'S"],
  // "is their fuel" for "is there fuel".
  [/\b(IS|ARE|WAS|WERE|THERE'S) THEIR\b/g, "$1 THERE"],
  // "fuel" heard as few, feel, full or fill.
  [
    /\b(FEW|FEEL|FULL|FILL|FUELS|FUELLED|FUELED|FEWER) (STOP|STOPS|STOPPED|STATION|STATIONS|UP|LEFT|THERE|AT|AVAILABLE|NEARBY|SOON|LEVEL|GAUGE|TANK)\b/g,
    "FUEL $2",
  ],
  [
    /\b(NEXT|NEAREST|CLOSEST|A|ANY|GET|GETTING|NEED|FOR|SOME|MORE|MUCH|ENOUGH|THE|OF|ON) (FEW|FEEL|FULL|FILL|FUELS)\b/g,
    "$1 FUEL",
  ],
  // "stop" heard as stopped or stuff ("stops" is left alone: "my stops"
  // is a real question about the whole plan).
  [
    /\b(REST|NEXT|TRUCK|MY|A|THE|FUEL|FIRST|LAST|FINAL|PLANNED) (STOPPED|STUFF|STOCK|STOPPING|STOPE)\b/g,
    "$1 STOP",
  ],
  [/\bREST (AREAS|ERA|ARIA|AREA'S|AIR)\b/g, "REST AREA"],
  // "stop" heard as "top" (12 October 2026 test drive), but never in
  // "top up", which is about fuel.
  [
    /\b(NEXT|REST|FUEL|THE|MY|A|THAT|THIS|FIRST|SECOND|LAST|FINAL|PLANNED|NEW|TRUCK|NEAREST|CLOSEST|EACH|EVERY|ONE|OTHER) TOPS?\b(?! UP)/g,
    "$1 STOP",
  ],
  [/\bTOP (TALKING|IT|THAT|NOW|PLEASE)\b/g, "STOP $1"],
  [/^TOP$/g, "STOP"],
  // "reroute" heard as two words.
  [/\b(RE|REE|WE) (ROOT|ROUT|WROTE|ROUTE)\b/g, "REROUTE"],
  [/\bNEW (ROOT|WROTE|ROUT)\b/g, "NEW ROUTE"],
  [/\bE T A\b/g, "ETA"],
  [/\bK (M|MS)\b/g, "KM"],
  [/\bKAY\b/g, "KAYS"],
  [/\bCLICKS\b/g, "KAYS"],
  [/\bNAVIGATIONS\b/g, "NAVIGATION"],
];

/** The sentence with the engine's usual mishearings put right. */
export function normalise(command: string): string {
  let t = words(command).join(" ");
  for (const [pattern, replacement] of SOUND_ALIKES) {
    t = t.replace(pattern, replacement);
  }
  return t;
}

const END_NAVIGATION =
  /(?:^| )(?:END|AND|STOP|FINISH|CANCEL|EXIT|QUIT|CLOSE|TERMINATE)(?: THE| MY| THIS)? (?:NAVIGATION|NAVIGATING|NAV|JOURNEY|TRIP|GUIDANCE|ROUTE)(?: |$)/;

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
      "RESTROOMS",
      "WASHROOM",
      "TOILET BLOCK",
    ],
    "TOILETS",
  ],
  [["SHOWER", "SHOWERS"], "SHOWERS"],
  [["WATER", "DRINKING WATER", "TAP", "A DRINK"], "WATER"],
  [
    [
      "FOOD",
      "CAFE",
      "COFFEE",
      "EAT",
      "MEAL",
      "RESTAURANT",
      "SOMETHING TO EAT",
      "TAKEAWAY",
      "SHOP",
      "FEED",
    ],
    "FOOD",
  ],
  [["LIGHT", "LIGHTS", "LIGHTING", "LIT"], "LIGHTING"],
  [["SHADE", "SHELTER", "SHELTERED", "COVER"], "SHADE"],
  [
    [
      "TABLE",
      "TABLES",
      "PICNIC",
      "SEAT",
      "SEATS",
      "SEATING",
      "BENCH",
      "BENCHES",
      "SIT",
      "SIT DOWN",
    ],
    "SEATING",
  ],
  [["BIN", "BINS", "RUBBISH"], "BIN"],
  [["BBQ", "BARBECUE", "BARBIE"], "BBQ"],
  [["POWER", "POWER POINT", "CHARGE", "CHARGING", "PLUG"], "POWER"],
];

function namedFacility(text: string): string | null {
  for (const [spoken, facility] of FACILITY_WORDS) {
    if (has(text, ...spoken)) {
      return facility;
    }
  }
  return null;
}

/*
 * Things drivers ask that RouteRest has no data for. Rory names the topic
 * rather than giving the generic "I can only help with this journey".
 */
const UNAVAILABLE_TOPICS: Array<[string[], string]> = [
  [
    [
      "WEATHER",
      "RAIN",
      "RAINING",
      "STORM",
      "STORMS",
      "TEMPERATURE",
      "FORECAST",
      "WIND",
      "WINDY",
      "SNOW",
      "FOG",
      "FOGGY",
      "HOT",
      "COLD",
      "SUNNY",
    ],
    "weather",
  ],
  [
    [
      "TRAFFIC",
      "ROADWORKS",
      "ROAD WORKS",
      "ACCIDENT",
      "CRASH",
      "CONGESTION",
      "DELAYS",
      "JAM",
      "ROAD CLOSED",
      "CLOSURE",
      "FLOODING",
    ],
    "traffic",
  ],
  [
    [
      "SPEED LIMIT",
      "SPEED LIMITS",
      "SPEED CAMERA",
      "SPEED CAMERAS",
      "POLICE",
      "COPS",
      "BOOZE BUS",
      "RBT",
      "WEIGHBRIDGE",
      "WEIGH BRIDGE",
      "INSPECTION",
    ],
    "road-info",
  ],
  [
    [
      "MUSIC",
      "RADIO",
      "SONG",
      "SONGS",
      "PLAYLIST",
      "PODCAST",
      "SPOTIFY",
      "VOLUME",
      "PLAY SOME",
      "PLAY ME",
    ],
    "music",
  ],
  [
    ["CALL", "RING", "PHONE", "TEXT", "MESSAGE", "SMS", "DIAL", "WHATSAPP"],
    "calls",
  ],
  [
    [
      "PRICE",
      "PRICES",
      "COST",
      "COSTS",
      "CHEAPEST",
      "CHEAPER",
      "CHEAP",
      "TOLL",
      "TOLLS",
      "EXPENSIVE",
      "DOLLARS",
      "PAY",
      "HOW MUCH IS DIESEL",
      "HOW MUCH IS FUEL",
      "HOW MUCH IS PETROL",
      "HOW MUCH DOES DIESEL",
      "HOW MUCH DOES FUEL",
      "HOW MUCH DOES PETROL",
    ],
    "prices",
  ],
  [["JOKE", "JOKES", "STORY", "SING", "RIDDLE", "POEM"], "entertainment"],
  [
    ["NEWS", "SCORE", "SCORES", "FOOTY", "CRICKET", "MATCH", "HEADLINES"],
    "news",
  ],
  [
    [
      "LOAD",
      "CARGO",
      "DELIVERY",
      "FREIGHT",
      "PALLETS",
      "CUSTOMER",
      "DOCKET",
      "CONSIGNMENT",
      "PICKUP",
      "PICK UP",
    ],
    "load",
  ],
];

function unavailableTopic(text: string): string | null {
  for (const [spoken, topic] of UNAVAILABLE_TOPICS) {
    if (has(text, ...spoken)) {
      return topic;
    }
  }
  return null;
}

/** "And after that?", "the one after": a question about the stop after next. */
function subjectOf(text: string): RorySubject {
  return has(
    text,
    "AFTER THAT",
    "AFTER THIS",
    "AFTER NEXT",
    "AFTER MY NEXT",
    "AFTER THE NEXT",
    "THE ONE AFTER",
    "ONE AFTER",
    "FOLLOWING STOP",
    "FOLLOWING ONE",
    "STOP AFTER",
    "THEN WHAT",
    "AND THEN",
    "SECOND STOP",
    "STOP AFTER THAT",
  )
    ? "after"
    : "next";
}

/*
 * Facilities the rest area data records, so a search can filter on them
 * (roryAnswers.ts FACILITY_LABELS). Showers and food are not recorded,
 * so asking to find them gets the "the data doesn't record" answer.
 */
const SEARCHABLE_FACILITIES = new Set([
  "TOILETS",
  "WATER",
  "LIGHTING",
  "SHADE",
  "SEATING",
  "BIN",
  "BBQ",
  "POWER",
]);

/** "Find me a toilet" rather than "are there toilets at my next stop". */
function asksToFind(text: string): boolean {
  if (
    has(text, "NEXT", "PLANNED", "MY STOP", "THE STOP", "AFTER", "DESTINATION")
  ) {
    return false;
  }
  return has(
    text,
    "FIND",
    "NEAREST",
    "CLOSEST",
    "NEARBY",
    "NEAR ME",
    "NEAR HERE",
    "AROUND HERE",
    "CLOSE BY",
    "WHERE CAN I",
    "WHERE ARE THE",
    "WHERE IS THE",
    "WHERE'S THE",
    "I NEED",
    "NEED A",
    "NEED THE",
    "NEED TO GO",
    "GET ME",
    "TAKE ME",
    "LOOKING FOR",
    "LOOK FOR",
    "SEARCH",
  );
}

const FUEL_WORDS =
  "FUEL|REFUEL|REFUELLING|REFUELING|FILL UP|DIESEL|PETROL|SERVO|SERVICE STATION|FUEL STOP|FUEL STATION|GAS";
const REST_WORDS = "REST|SLEEP|NAP|BREAK|REST STOP|REST AREA|SLEEP STOP";

/**
 * Which stop the driver wants to go to first, or null. "fuel" moves the
 * fuel stop up, "rest" the rest stop, "swap" swaps the next two stops.
 */
function reorderTopic(text: string): "fuel" | "rest" | "swap" | null {
  const fuelFirst =
    new RegExp(`(?:^| )(?:${FUEL_WORDS})(?: [A-Z']+){0,3} FIRST(?: |$)`).test(
      text,
    ) ||
    new RegExp(
      `(?:^| )FIRST (?:I NEED TO |I WANT TO |LET'S |LETS )?(?:${FUEL_WORDS})(?: |$)`,
    ).test(text) ||
    new RegExp(
      `(?:^| )(?:${FUEL_WORDS})(?: [A-Z']+){0,4} BEFORE (?:I |WE )?(?:THE |MY )?(?:${REST_WORDS})(?: |$)`,
    ).test(text);
  if (fuelFirst) return "fuel";
  const restFirst =
    new RegExp(`(?:^| )(?:${REST_WORDS})(?: [A-Z']+){0,3} FIRST(?: |$)`).test(
      text,
    ) ||
    new RegExp(
      `(?:^| )(?:${REST_WORDS})(?: [A-Z']+){0,4} BEFORE (?:I |WE )?(?:THE |MY )?(?:${FUEL_WORDS})(?: |$)`,
    ).test(text);
  if (restFirst) return "rest";
  if (
    has(
      text,
      "SWAP",
      "SWITCH THE STOPS",
      "SWITCH STOPS",
      "SWITCH THE ORDER",
      "SWITCH THEM",
      "REORDER",
      "RE ORDER",
      "CHANGE THE ORDER",
      "CHANGE ORDER",
      "OTHER WAY ROUND",
      "OTHER WAY AROUND",
      "THE OTHER ONE FIRST",
    )
  )
    return "swap";
  return null;
}

type Classified = {
  intent: RoryIntent;
  facility: string | null;
  topic: string | null;
  subject: RorySubject;
};

/**
 * The intent of a command, the words after the wake phrase. The order of
 * the checks matters: "is there fuel at the next stop" is about fuel, not
 * the next stop, "is the camera on" is a question and not the command to
 * turn it on, and "where is my next rest stop" is a question about the
 * plan, not a request to find a new stop.
 */
export function classify(command: string): Classified {
  const t = normalise(command);
  const subject = subjectOf(t);
  const result = (
    intent: RoryIntent,
    facility: string | null = null,
    topic: string | null = null,
  ): Classified => ({ intent, facility, topic, subject });

  if (!t) return result("help");

  // ---- Controls first: short, distinctive phrases.
  // The verb must sit right next to the noun: "how far and how long is my
  // trip" contains AND and TRIP but is not a request to stop. ("AND" is
  // here because the engine hears "end navigation" as "and navigation".)
  if (END_NAVIGATION.test(t)) return result("end-navigation");
  if (
    has(
      t,
      "MUTE",
      "VOICE OFF",
      "SILENCE",
      "TURN OFF THE VOICE",
      "TURN THE VOICE OFF",
      "TURN OFF VOICE",
      "NO MORE TALKING",
      "STOP THE VOICE",
      "VOICE GUIDANCE OFF",
    )
  )
    return result("mute");
  if (
    has(
      t,
      "VOICE ON",
      "UNMUTE",
      "START TALKING",
      "TALK TO ME",
      "SOUND ON",
      "TURN ON THE VOICE",
      "TURN THE VOICE ON",
      "VOICE GUIDANCE ON",
    )
  )
    return result("unmute");
  // Distinctive phrases anywhere in the sentence; short ones ("enough",
  // "stop") only as the whole sentence, so "do I have enough fuel" and
  // "next stop" are still questions.
  if (
    has(
      t,
      "BE QUIET",
      "QUIET",
      "STOP TALKING",
      "SHUT UP",
      "SHUSH",
      "SHH",
      "HUSH",
    ) ||
    whole(
      t,
      "STOP",
      "STOP IT",
      "ENOUGH",
      "THAT'S ENOUGH",
      "OKAY OKAY",
      "OK OK",
      "ALRIGHT ALRIGHT",
      "OKAY STOP",
      "OK STOP",
    )
  )
    return result("hush");
  if (
    has(
      t,
      "REPEAT",
      "SAY THAT AGAIN",
      "SAY IT AGAIN",
      "SAY AGAIN",
      "AGAIN",
      "COME AGAIN",
      "PARDON",
      "WHAT DID YOU SAY",
      "WHAT WAS THAT AGAIN",
      "I MISSED THAT",
      "I DIDN'T CATCH THAT",
      "ONE MORE TIME",
    )
  )
    return result("repeat");
  if (
    has(
      t,
      "NEVER MIND",
      "NEVERMIND",
      "FORGET IT",
      "DOESN'T MATTER",
      "DOES NOT MATTER",
      "CANCEL THAT",
      "THAT'S ALL",
      "THAT'S IT",
      "THAT'LL DO",
      "NOTHING",
      "NO THANKS",
      "NO THANK YOU",
      "ALL GOOD",
    )
  )
    return result("nevermind");

  // ---- The camera: a question about it, or an instruction.
  if (has(t, "CAMERA", "MONITORING", "EYE TRACKING", "FACE TRACKING")) {
    const instruction = has(
      t,
      "TURN",
      "SWITCH",
      "PUT",
      "START",
      "STOP",
      "DISABLE",
      "ENABLE",
      "ACTIVATE",
      "DEACTIVATE",
      "KILL",
      "SHUT",
    );
    if (
      !instruction &&
      (has(
        t,
        "IS",
        "STATUS",
        "RUNNING",
        "WORKING",
        "WATCHING",
        "ACTIVE",
        "STILL",
      ) ||
        /^(?:WHAT'S|WHAT IS|IS THE|IS MY|HOW'S|HOW IS)\b/.test(t))
    )
      return result("camera-status");
    if (has(t, "OFF", "STOP", "DISABLE", "DEACTIVATE", "KILL", "SHUT"))
      return result("camera-off");
    if (has(t, "ON", "START", "ENABLE", "ACTIVATE")) return result("camera-on");
    return result("camera-status");
  }

  if (
    has(
      t,
      "I'VE ARRIVED",
      "I HAVE ARRIVED",
      "WE'VE ARRIVED",
      "WE HAVE ARRIVED",
      "ARRIVED",
      "I'M HERE",
      "WE'RE HERE",
      "I AM HERE",
      "I'M PARKED",
      "I HAVE PARKED",
      "I'VE PARKED",
      "I'VE STOPPED",
      "I HAVE STOPPED",
      "I'M AT THE STOP",
      "MADE IT",
    )
  )
    return result("arrived");
  if (
    has(
      t,
      "DISMISS",
      "GOT IT",
      "ACKNOWLEDGE",
      "ACKNOWLEDGED",
      "CLEAR THE ALERT",
      "CLEAR THE WARNING",
      "CLEAR IT",
      "I'M OKAY",
      "I'M OK",
      "I AM OKAY",
      "I AM OK",
      "I'M FINE",
      "I'M AWAKE",
      "I'M ALRIGHT",
      "I'M ALL RIGHT",
      "UNDERSTOOD",
      "NOTED",
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
      "PLAN AGAIN",
      "ROUTE ME",
      "ANOTHER WAY",
      "DIFFERENT ROUTE",
      "ANOTHER ROUTE",
      "FIND A WAY",
      "GET ME BACK ON",
      "BACK ON ROUTE",
      "BACK ON TRACK",
    )
  )
    return result("reroute");

  // Changing the order of the stops: "I need to refuel first", "go to
  // the fuel stop first", "rest first", "swap the stops". The words
  // before FIRST decide which stop moves up; questions like "where is my
  // first stop" have nothing before FIRST and are not matched. The page
  // asks for a spoken yes before changing anything.
  const reorder = reorderTopic(t);
  if (reorder) return result("reorder-stops", null, reorder);

  // A driver saying they are tired wants somewhere to stop, not a report.
  if (
    has(
      t,
      "I'M TIRED",
      "I AM TIRED",
      "I FEEL TIRED",
      "I'M SLEEPY",
      "I AM SLEEPY",
      "I FEEL SLEEPY",
      "I'M DROWSY",
      "I FEEL DROWSY",
      "I'M EXHAUSTED",
      "I'M KNACKERED",
      "I'M STUFFED",
      "I'M FADING",
      "FALLING ASLEEP",
      "NODDING OFF",
      "KEEP MY EYES OPEN",
      "I NEED A BREAK",
      "I NEED A REST",
      "I NEED A NAP",
      "I NEED TO STOP",
      "I NEED TO REST",
      "I NEED TO SLEEP",
      "I NEED SLEEP",
      "I NEED TO PULL OVER",
      "NEED A REST",
      "NEED A BREAK",
    )
  )
    return result("find-rest-stop");

  // ---- Help, and talking to Rory itself.
  if (
    has(
      t,
      "HELP",
      "WHAT CAN YOU DO",
      "WHAT CAN I ASK",
      "WHAT CAN I SAY",
      "WHAT DO YOU DO",
      "HOW DO YOU WORK",
      "WHAT ARE YOU FOR",
      "WHAT COMMANDS",
      "WHAT ARE MY OPTIONS",
      "WHAT CAN YOU TELL ME",
      "HOW DO I USE",
      "INSTRUCTIONS",
    )
  )
    return result("help");
  if (
    has(
      t,
      "WHO ARE YOU",
      "WHAT'S YOUR NAME",
      "WHAT IS YOUR NAME",
      "WHAT ARE YOU",
      "ARE YOU A ROBOT",
      "ARE YOU REAL",
      "ARE YOU AN AI",
      "ARE YOU HUMAN",
      "ARE YOU THERE",
      "ARE YOU LISTENING",
      "CAN YOU HEAR ME",
      "YOU THERE",
      "ARE YOU AWAKE",
      "WHO MADE YOU",
    )
  )
    return result("identity");
  // Pleasantries only count when they are the whole sentence (give or
  // take a "Rory" or "mate"), so "great ocean road" stays a place.
  if (
    whole(
      t,
      "THANK YOU",
      "THANKS",
      "THANKS A LOT",
      "THANK YOU VERY MUCH",
      "THANKS VERY MUCH",
      "CHEERS",
      "TA",
      "GOOD JOB",
      "WELL DONE",
      "NICE ONE",
      "GOOD ON YOU",
      "AWESOME",
      "GREAT",
      "PERFECT",
      "COOL",
      "LEGEND",
      "YOU'RE THE BEST",
      "LOVE YOU",
      "GOOD WORK",
      "BEAUTY",
      "RIPPER",
      "THANKS FOR THAT",
      "THANK YOU FOR THAT",
    )
  )
    return result("thanks");
  if (
    whole(
      t,
      "GOOD NIGHT",
      "GOODNIGHT",
      "BYE",
      "GOODBYE",
      "BYE BYE",
      "SEE YA",
      "SEE YOU",
      "SEE YOU LATER",
      "CATCH YA",
      "CATCH YOU LATER",
      "LATER",
    )
  )
    return result("greeting", null, "bye");
  if (whole(t, "GOOD MORNING", "MORNING"))
    return result("greeting", null, "morning");
  if (whole(t, "GOOD AFTERNOON", "AFTERNOON"))
    return result("greeting", null, "afternoon");
  if (whole(t, "GOOD EVENING", "EVENING"))
    return result("greeting", null, "evening");
  if (
    has(
      t,
      "HOW ARE YOU",
      "HOW'S IT GOING",
      "HOW ARE YA",
      "HOW YOU GOING",
      "HOW ARE THINGS",
      "YOU GOOD",
      "YOU OKAY",
      "YOU OK",
      "HOW'S YOUR DAY",
      "WHAT'S UP",
    )
  )
    return result("greeting", null, "how-are-you");
  if (
    whole(
      t,
      "HELLO",
      "HI",
      "HEY",
      "HIYA",
      "G'DAY",
      "GDAY",
      "YO",
      "HOWDY",
      "HELLO THERE",
      "HI THERE",
    )
  )
    return result("greeting", null, "hello");

  // ---- Topics RouteRest has no data for, named so the answer is useful.
  // Checked before the journey rules because "what's the speed limit" and
  // "how much does diesel cost" share words with speed and fuel questions.
  const unavailable = unavailableTopic(t);
  if (unavailable) return result("unavailable", null, unavailable);

  // ---- Safety information.
  if (
    has(t, "WHY") ||
    has(t, "EXPLAIN") ||
    has(t, "WHAT WAS THAT", "WHAT'S THAT", "WHAT IS THAT") ||
    (has(
      t,
      "WARNING",
      "WARNINGS",
      "ALERT",
      "ALERTS",
      "ALARM",
      "BEEP",
      "BEEPING",
      "BUZZ",
      "NOTIFICATION",
      "THAT SOUND",
      "THAT NOISE",
      "REMINDER",
    ) &&
      !has(t, "DISMISS", "CLEAR"))
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
      "DROWSINESS",
      "ALERTNESS",
      "HOW ALERT",
      "HOW AM I DOING",
      "HOW AM I",
      "AM I OK",
      "AM I OKAY",
      "AM I FIT",
      "AM I SAFE",
      "AM I TIRED",
      "MY STATE",
      "STATE CHECK",
      "MY CONDITION",
      "MY EYES",
      "EYES CLOSED",
      "EYES CLOSING",
      "SELF CHECK",
      "FATIGUE LEVEL",
      "FATIGUE SCORE",
      "FATIGUE CHECK",
    ) &&
    !has(t, "FIND", "NEED", "WANT")
  )
    return result("fatigue-status");

  // ---- The rules behind the plan: how long before a rest is required.
  if (
    has(
      t,
      "LEGAL",
      "LEGALLY",
      "LAW",
      "ALLOWED",
      "LIMIT",
      "LIMITS",
      "MAXIMUM",
      "MAX",
      "LOGBOOK",
      "LOG BOOK",
      "WORK DIARY",
      "NHVR",
      "REGULATION",
      "REGULATIONS",
      "RULES",
      "COMPLIANT",
      "COMPLIANCE",
      "HAVE TO STOP",
      "MUST STOP",
      "MUST I",
      "DO I HAVE TO",
      "NEED TO STOP BY",
      "REQUIRED",
      "HOW LONG CAN I",
      "HOW MUCH LONGER CAN I",
      "KEEP DRIVING",
      "KEEP GOING",
      "DRIVE FOR",
      "HOURS CAN I",
      "WORK HOURS",
      "DRIVING HOURS",
      "MANDATORY",
    ) &&
    has(
      t,
      "STOP",
      "REST",
      "BREAK",
      "DRIVE",
      "DRIVING",
      "HOURS",
      "WORK",
      "GO",
      "GOING",
      "SLEEP",
      "BEFORE",
      "SHIFT",
      "LEGAL",
      "LEGALLY",
      "LAW",
      "RULES",
      "LOGBOOK",
      "LOG BOOK",
      "WORK DIARY",
      "NHVR",
    )
  )
    return result("rest-rule");

  // ---- Journey information. Fuel and facilities before "next stop".
  if (
    has(
      t,
      "WHAT TIME IS IT",
      "WHAT'S THE TIME",
      "WHAT IS THE TIME",
      "TIME IS IT",
      "CURRENT TIME",
      "TIME NOW",
      "THE TIME",
      "WHAT DAY",
      "WHAT'S THE DATE",
      "WHAT IS THE DATE",
      "THE DATE",
      "DATE TODAY",
      "WHAT DATE",
      "TODAY'S DATE",
    ) &&
    !has(t, "ARRIVE", "ARRIVAL", "GET THERE", "REACH", "STOP", "BREAK", "REST")
  )
    return result("current-time");
  if (
    has(
      t,
      "HOW LONG HAVE I",
      "HOW LONG HAVE WE",
      "BEEN DRIVING",
      "BEEN ON THE ROAD",
      "BEEN GOING",
      "BEEN NAVIGATING",
      "SINCE I LEFT",
      "SINCE I STARTED",
      "SINCE WE LEFT",
      "WHEN DID I START",
      "WHEN DID I LEAVE",
      "WHEN DID WE START",
      "WHEN DID WE LEAVE",
      "DRIVEN SO FAR",
      "DRIVING SO FAR",
      "TIME DRIVEN",
      "ON THE ROAD FOR",
      "HOW LONG AGO DID",
      "TIME SINCE",
    )
  )
    return result("driving-duration");
  if (
    has(
      t,
      "HOW FAST",
      "SPEED",
      "MY SPEED",
      "KMH",
      "KPH",
      "K P H",
      "KILOMETRES AN HOUR",
      "KILOMETRES PER HOUR",
      "KILOMETERS AN HOUR",
      "KILOMETERS PER HOUR",
      "AM I SPEEDING",
      "TOO FAST",
      "SLOW DOWN",
    )
  )
    return result("speed");

  // Fuel: the gauge is not known; the plan knows where fuel is likely.
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
      "TRUCK STOP",
      "ROADHOUSE",
      "ROAD HOUSE",
      "TOP UP",
      "BOWSER",
      "PUMP",
      "PUMPS",
    )
  ) {
    // "Do I need fuel?" is about the gauge; checked before "I need fuel".
    const gauge = has(
      t,
      "DO I NEED",
      "HOW MUCH FUEL",
      "HOW MUCH DIESEL",
      "ENOUGH",
      "GAUGE",
      "TANK",
      "RANGE",
      "HOW LONG WILL",
      "HOW FAR CAN I",
    );
    // A request to go and get fuel, rather than a question about the
    // planned stops: search nearby for a service centre.
    if (
      !gauge &&
      has(
        t,
        "FIND",
        "NEAREST",
        "CLOSEST",
        "NEARBY",
        "NEAR ME",
        "NEAR HERE",
        "AROUND HERE",
        "CLOSE BY",
        "WHERE CAN I",
        "GET ME",
        "TAKE ME",
        "LOOK FOR",
        "LOOKING FOR",
        "SEARCH",
        "LOCATE",
        "I NEED",
        "NEED TO",
        "I WANT",
        "I'M LOW",
        "I AM LOW",
        "RUNNING LOW",
        "LOW ON",
        "RUNNING OUT",
        "ALMOST OUT",
        "ALMOST EMPTY",
        "ON EMPTY",
      )
    )
      return result("find-fuel");
    const level = has(
      t,
      "LEFT",
      "LEVEL",
      "TANK",
      "RANGE",
      "HOW MUCH FUEL",
      "ENOUGH",
      "RUN OUT",
      "RUNNING OUT",
      "EMPTY",
      "GAUGE",
      "DO I NEED",
      "NEED FUEL",
      "LOW",
      "REMAINING",
    );
    return result("fuel", null, level ? "level" : null);
  }
  const facility = namedFacility(t);
  if (facility && SEARCHABLE_FACILITIES.has(facility) && asksToFind(t))
    return result("find-rest-stop", facility);
  if (
    facility ||
    has(
      t,
      "FACILITIES",
      "FACILITY",
      "AMENITIES",
      "WHAT'S THERE",
      "WHAT IS THERE",
      "WHAT'S AT",
      "WHAT IS AT",
      "WHAT DOES IT HAVE",
      "WHAT HAS IT GOT",
      "WHAT'S IT GOT",
      "WHAT'S AVAILABLE",
      "WHAT IS AVAILABLE",
      "ANYTHING THERE",
      "IS THERE ANYTHING",
      "WHAT KIND OF",
      "WHAT SORT OF",
      "WHAT DO THEY HAVE",
      "WHAT'S THE STOP LIKE",
      "WHAT'S IT LIKE",
    )
  )
    return result("facilities", facility);
  if (
    has(
      t,
      "NEXT TURN",
      "WHERE DO I TURN",
      "WHEN DO I TURN",
      "DO I TURN",
      "WHICH WAY",
      "WHICH EXIT",
      "WHAT EXIT",
      "DIRECTIONS",
      "DIRECTION",
      "NEXT INSTRUCTION",
      "WHERE DO I GO",
      "HOW DO I GET",
      "WHAT ROAD DO I",
      "WHAT'S THE NEXT TURN",
      "TURN LEFT",
      "TURN RIGHT",
      "TURN OFF",
      "TURN",
      "EXIT",
      "ROUNDABOUT",
      "MERGE",
      "LANE",
    )
  )
    return result("next-turn");

  // The whole trip, not what is left of it.
  if (
    has(
      t,
      "WHOLE",
      "ENTIRE",
      "TOTAL",
      "FULL",
      "OVERALL",
      "ALTOGETHER",
      "ALL UP",
      "IN TOTAL",
      "THE TRIP",
      "THIS TRIP",
      "THE JOURNEY",
      "THIS JOURNEY",
      "MY TRIP",
      "MY JOURNEY",
      "THE ROUTE",
      "THIS ROUTE",
      "TRIP SUMMARY",
      "SUMMARY",
      "OVERVIEW",
    ) &&
    has(
      t,
      "DISTANCE",
      "LONG",
      "FAR",
      "KILOMETRES",
      "KILOMETERS",
      "KM",
      "KAYS",
      "HOURS",
      "TAKE",
      "TIME",
      "SUMMARY",
      "OVERVIEW",
      "ABOUT",
      "LOOK LIKE",
      "LIKE",
    ) &&
    !has(t, "LEFT", "REMAINING", "TO GO", "MORE", "UNTIL", "TILL")
  )
    return result("trip-summary");

  // Where the trip ends, and where the truck is now.
  if (
    has(
      t,
      "DESTINATION",
      "WHERE AM I GOING",
      "WHERE ARE WE GOING",
      "WHERE AM I HEADED",
      "WHERE ARE WE HEADED",
      "WHERE AM I HEADING",
      "WHERE ARE WE HEADING",
      "WHERE AM I OFF TO",
      "FINAL STOP",
      "LAST STOP",
      "END OF THE TRIP",
      "END OF MY TRIP",
      "END OF THE JOURNEY",
      "WHERE DOES THIS TRIP",
      "WHERE DOES THE TRIP",
      "WHERE DOES THIS END",
      "WHERE DOES IT END",
      "DELIVERING TO",
      "WHERE TO",
      "WHERE WE'RE GOING",
      "WHERE I'M GOING",
    )
  )
    return result("destination");
  if (
    has(
      t,
      "WHERE AM I",
      "WHERE ARE WE",
      "WHEREABOUTS",
      "WHERE ABOUTS",
      "WHAT ROAD",
      "WHICH ROAD",
      "WHAT HIGHWAY",
      "WHICH HIGHWAY",
      "MY LOCATION",
      "CURRENT LOCATION",
      "MY POSITION",
      "HOW FAR HAVE I",
      "HOW FAR HAVE WE",
      "HOW FAR INTO",
      "HOW FAR FROM THE START",
      "HOW FAR SINCE",
      "SO FAR",
      "TRAVELLED",
      "TRAVELED",
      "COVERED",
      "DONE SO FAR",
      "AM I ON THE ROUTE",
      "AM I ON ROUTE",
      "AM I OFF ROUTE",
      "ON THE RIGHT ROAD",
      "ON THE RIGHT TRACK",
      "ON TRACK",
      "ON COURSE",
    ) &&
    !has(t, "TO GO", "LEFT", "REMAINING", "MORE TO", "GOING")
  )
    return result("where-am-i");

  // How many stops are still planned, and how much rest.
  if (
    has(
      t,
      "HOW MANY",
      "MANY MORE",
      "MORE STOPS",
      "MORE BREAKS",
      "STOPS LEFT",
      "STOPS ARE LEFT",
      "BREAKS LEFT",
      "STOPS REMAINING",
      "BREAKS REMAINING",
      "REMAINING STOPS",
      "STOPS DO I",
      "BREAKS DO I",
      "STOPS BEFORE",
      "STOPS UNTIL",
      "ANY MORE STOPS",
      "OTHER STOPS",
      "ALL MY STOPS",
      "ALL THE STOPS",
      "LIST THE STOPS",
      "LIST MY STOPS",
      "WHAT ARE MY STOPS",
      "WHAT STOPS",
      "WHICH STOPS",
      "STOPS ON THIS",
      "STOPS ARE PLANNED",
      "PLANNED STOPS",
      "STOPS HAVE I GOT",
      "STOPS ARE THERE",
      "STOPS AHEAD",
      "BREAKS AHEAD",
      "REST OF MY STOPS",
      "REST OF THE STOPS",
      "WHAT'S THE PLAN",
      "WHAT IS THE PLAN",
      "MY PLAN",
      "THE PLAN",
      "REST PLAN",
    ) &&
    has(t, "STOP", "STOPS", "BREAK", "BREAKS", "REST", "RESTS", "PLAN")
  )
    return result("stops-remaining");
  // "When do I reach my next stop" before "how long is my break".
  if (
    has(
      t,
      "WHEN IS",
      "WHEN'S",
      "WHEN DO I",
      "WHEN WILL I",
      "WHEN CAN I",
      "WHEN DO WE",
      "WHEN WILL WE",
      "HOW LONG UNTIL",
      "HOW LONG TILL",
      "HOW LONG BEFORE",
      "HOW LONG TO MY",
      "HOW LONG TO THE",
      "HOW LONG TO GET TO",
      "HOW SOON",
      "HOW MUCH LONGER UNTIL",
      "HOW MUCH LONGER TILL",
      "HOW MUCH LONGER BEFORE",
      "TIME UNTIL",
      "TIME TILL",
      "MINUTES UNTIL",
      "MINUTES TILL",
      "MINUTES TO",
      "HOW FAR AWAY IS",
      "WHAT TIME IS MY",
      "WHAT TIME DO I",
      "WHAT TIME WILL I GET TO",
      "WHAT TIME DO WE",
      "WHEN DO I GET TO",
      "WHEN WILL I REACH",
      "WHEN DO I REACH",
      "WHEN WILL I GET TO",
    ) &&
    has(
      t,
      "STOP",
      "BREAK",
      "REST",
      "PULL OVER",
      "SLEEP",
      "NEXT",
      "NAP",
      "PARK",
      "IT",
      "THERE",
    )
  )
    return result("next-break-time");
  if (
    has(
      t,
      "REST",
      "BREAK",
      "STOP",
      "STOPS",
      "BREAKS",
      "NAP",
      "SLEEP",
      "PAUSE",
      "RESTS",
    ) &&
    has(
      t,
      "HOW MUCH",
      "HOW LONG",
      "LONG IS",
      "LONG ARE",
      "LONG DO",
      "LONG WILL",
      "LONG CAN",
      "TOTAL",
      "MINUTES",
      "HOURS",
      "PLANNED",
      "DO I GET",
      "DO I HAVE",
      "HAVE I GOT",
      "LENGTH",
    ) &&
    !has(
      t,
      "UNTIL",
      "TILL",
      "BEFORE",
      "TO GO",
      "AWAY",
      "TO MY",
      "TO THE NEXT",
      "MANY",
    )
  )
    return result("rest-ahead");

  // "Find me a rest stop" against "where is my next rest stop".
  const nearby = has(
    t,
    "NEAREST",
    "CLOSEST",
    "NEARBY",
    "NEAR ME",
    "NEAR HERE",
    "AROUND HERE",
    "CLOSE BY",
    "CLOSE TO ME",
    "SOMEWHERE TO",
    "A PLACE TO",
    "PLACE TO",
    "ANYWHERE TO",
    "PULL OVER",
    "PULL IN",
    "PULL UP",
  );
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
    "WHICH",
    "WHAT'S THE",
    "WHAT IS THE",
    "WHAT'S",
    "TELL ME",
    "PLANNED",
    "MY STOP",
    "MY BREAK",
    "MY REST",
    "AFTER",
  );
  if (
    nearby ||
    (!asksAboutPlan &&
      has(
        t,
        "FIND",
        "NEED",
        "WANT",
        "LOOKING FOR",
        "LOOK FOR",
        "GET ME",
        "SHOW ME",
        "TAKE ME",
        "SEARCH",
        "LOCATE",
        "SUGGEST",
        "RECOMMEND",
        "GIVE ME",
      ))
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
      "NEXT PLANNED",
      "UPCOMING STOP",
      "FIRST STOP",
      "NEXT ONE",
      "WHAT'S NEXT",
      "WHAT IS NEXT",
      "WHAT'S COMING UP",
      "COMING UP",
      "UP AHEAD",
      "UP NEXT",
      "NEXT PLACE",
      "NEXT TOWN",
      "WHERE DO I STOP",
      "WHERE DO WE STOP",
      "WHERE'S MY STOP",
      "WHERE IS MY STOP",
      "NAME OF THE STOP",
      "NAME OF MY STOP",
      "STOP CALLED",
    ) ||
    (has(
      t,
      "WHERE",
      "WHERE'S",
      "WHEN",
      "WHEN'S",
      "WHICH",
      "WHAT",
      "WHAT'S",
      "TELL ME",
      "IS THERE",
      "DO I HAVE",
      "HAVE I GOT",
    ) &&
      has(
        t,
        "STOP",
        "BREAK",
        "REST",
        "PARK",
        "REST AREA",
        "STOPPING",
        "PULL",
        "NAP",
        "SLEEP",
      ))
  )
    return result("next-stop");
  if (
    has(
      t,
      "HOW LONG",
      "TIME LEFT",
      "TIME REMAINING",
      "TIME TO GO",
      "WHEN WILL I",
      "WHEN DO I",
      "WHEN WILL WE",
      "WHEN DO WE",
      "WHAT TIME",
      "ARRIVAL",
      "ARRIVE",
      "ARRIVING",
      "ETA",
      "DRIVING TIME",
      "HOW MUCH LONGER",
      "ARE WE THERE YET",
      "GET THERE",
      "REACH",
      "HOURS",
      "MINUTES",
      "TIME",
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
      "KM",
      "KAYS",
      "K'S",
      "MILES",
      "LEFT TO GO",
      "HOW MUCH FURTHER",
      "HOW MUCH FARTHER",
      "FURTHER",
      "FARTHER",
      "TO GO",
      "HOW MUCH MORE",
      "HOW MUCH LEFT",
      "REMAINING",
      "HOW MUCH IS LEFT",
    )
  )
    return result("distance");
  if (
    has(t, "FIND", "NEED", "WANT", "LOOKING") &&
    has(t, "REST", "STOP", "BREAK", "PARK", "SLEEP", "NAP")
  )
    return result("find-rest-stop");
  // "And after that?" with nothing else named: the stop after next.
  if (subject === "after") return result("next-stop");

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
  "YES PLEASE",
  "ABSOLUTELY",
  "DEFINITELY",
  "GO FOR IT",
  "ALRIGHT",
  "ALL RIGHT",
  "RIGHT",
  "FINE",
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
  "NEGATIVE",
  "NO THANKS",
  "NO WAY",
  "SKIP",
  "SKIP IT",
];

// Australian "no worries" and "no problem" mean yes; checked before NO.
const YES_PHRASES_WITH_NO = ["NO WORRIES", "NO PROBLEM", "NO PROBLEMS"];
// Single words that answer on their own anywhere in a short reply.
const YES_WORDS = new Set([
  "YES",
  "YEAH",
  "YEP",
  "YUP",
  "YA",
  "SURE",
  "OK",
  "OKAY",
  "PLEASE",
]);
const NO_WORDS = new Set(["NO", "NOPE", "NAH", "CANCEL", "DON'T", "NEGATIVE"]);

/**
 * A yes or no in the answer to Rory's question.
 *
 * 16 October 2026: a driver said "yes please" and Rory did not take it.
 * The engine hears "yes please" correctly (tested in six accents), so the
 * sentence was most likely joined to the end of Rory's own "Say yes or
 * no" coming back through the speaker, giving "OR NO YES PLEASE". So the
 * tail of that prompt is dropped first, and in a short reply the answer
 * word may come after filler ("UM YES PLEASE", "I SAID YES").
 */
export function yesOrNo(command: string): "confirm" | "decline" | null {
  let tokens = words(command);
  // Rory's own "...yes or no" heard back before the driver's answer.
  for (let i = tokens.length - 2; i >= 0; i -= 1) {
    if (tokens[i] === "OR" && tokens[i + 1] === "NO") {
      tokens = tokens.slice(i + 2);
      break;
    }
  }
  if (tokens.length === 0) {
    return null;
  }
  const start = tokens.slice(0, 3).join(" ");
  const startsWith = (list: string[]) =>
    list.some((w) => new RegExp(`^${w}(?: |$)`).test(start));
  const short = tokens.length <= 4;
  // "No worries" and "okay, no problem" are a yes, before any "no" counts.
  if (
    tokens.length <= 5 &&
    YES_PHRASES_WITH_NO.some((w) => ` ${tokens.join(" ")} `.includes(` ${w} `))
  ) {
    return "confirm";
  }
  // "No" wins over "okay" in "no okay leave it", and "please no" is a no.
  if (startsWith(NO)) return "decline";
  if (short && tokens.some((t) => NO_WORDS.has(t))) return "decline";
  if (startsWith(YES)) return "confirm";
  // "Um yes please", "I said yes".
  if (short && tokens.some((t) => YES_WORDS.has(t))) return "confirm";
  return null;
}

/*
 * What may be asked as a follow-up without the wake phrase. Questions and
 * the rest stop search (which only looks; adding the stop needs a spoken
 * yes). Anything that changes the journey, and anything a passenger might
 * say to the driver (hello, thanks), still needs "Hey Rory".
 */
const FOLLOW_UP_INTENTS = new Set<RoryIntent>([
  "distance",
  "time",
  "next-stop",
  "next-break-time",
  "stops-remaining",
  "rest-ahead",
  "fuel",
  "facilities",
  "next-turn",
  "destination",
  "where-am-i",
  "speed",
  "driving-duration",
  "current-time",
  "trip-summary",
  "rest-rule",
  "fatigue-status",
  "alert-explain",
  "camera-status",
  "find-rest-stop",
  "find-fuel",
  // Asks for a spoken yes before anything changes, so it is safe without
  // the wake phrase too ("...and I need to refuel first").
  "reorder-stops",
  "repeat",
  "help",
  "nevermind",
  "hush",
]);

/*
 * Short questions that lean on what Rory just said: "how far is it?",
 * "does it have fuel?", "what's there?". Each needs a referent, which is
 * the stop of the last answer.
 */
const ELLIPTICAL: Array<[RegExp, RoryIntent]> = [
  [
    /^(?:AND )?(?:HOW FAR(?: AWAY| IS IT| IS THAT| TO (?:IT|THAT|THERE))?|HOW LONG(?: TO GET THERE| UNTIL| TILL| AWAY| IS IT)?|WHEN(?: IS IT| IS THAT| DO I GET THERE)?|HOW SOON|HOW MANY KAYS|HOW MANY KILOMETRES)$/,
    "next-break-time",
  ],
  [
    /^(?:AND )?(?:(?:DOES|HAS|IS) (?:IT|THAT|THERE)(?: GOT| HAVE)? FUEL|(?:ANY|WHAT ABOUT|AND) FUEL|FUEL(?: THERE)?)$/,
    "fuel",
  ],
  [
    /^(?:AND )?(?:WHAT'S THERE|WHAT IS THERE|WHAT'S AT IT|WHAT DOES IT HAVE|WHAT HAS IT GOT|WHAT'S IT GOT|ANYTHING THERE|WHAT ABOUT FACILITIES|FACILITIES|FACILITIES THERE|WHAT'S IT LIKE)$/,
    "facilities",
  ],
  [
    /^(?:AND )?(?:WHAT'S THE NAME|WHAT IS IT CALLED|WHAT'S IT CALLED|WHERE IS IT|WHERE'S THAT|WHERE IS THAT|WHICH ONE|WHAT IS IT)$/,
    "next-stop",
  ],
];

/**
 * Intents whose answer is about a planned stop, so a follow-up can refer
 * to it. Not the searches: the stop they find is not in the plan until
 * the driver says yes, and Rory then waits for that yes or no instead.
 */
const ABOUT_A_STOP = new Set<RoryIntent>([
  "next-stop",
  "next-break-time",
  "fuel",
  "facilities",
  "rest-ahead",
]);

/**
 * The whole decision for one sentence. See RoryExpecting for what Rory
 * may be waiting for, and RoryLast for what "it" refers to in a follow-up.
 */
export function parseSentence(
  text: string,
  expecting: RoryExpecting | null = null,
  last: RoryLast | null = null,
): ParsedSentence {
  const tokens = words(text);
  const wake = wakeWordLength(tokens);
  const command = tokens.slice(wake).join(" ");
  const ignored: ParsedSentence = {
    addressed: false,
    command,
    intent: null,
    facility: null,
    topic: null,
    subject: "next",
  };

  if (wake === 0) {
    if (expecting === "answer") {
      const answer = yesOrNo(command);
      if (answer) {
        return { ...ignored, addressed: true, intent: answer };
      }
      return ignored;
    }
    if (expecting === "command" && command) {
      return {
        addressed: true,
        command,
        ...classifyWithContext(command, last),
      };
    }
    if (expecting === "follow-up" && command) {
      const parsed = classifyWithContext(command, last);
      if (FOLLOW_UP_INTENTS.has(parsed.intent)) {
        return { addressed: true, command, ...parsed };
      }
    }
    return ignored;
  }

  if (!command) {
    return { ...ignored, addressed: true };
  }
  if (expecting === "answer") {
    const answer = yesOrNo(command);
    if (answer) {
      return { ...ignored, addressed: true, intent: answer };
    }
  }
  return { addressed: true, command, ...classifyWithContext(command, last) };
}

/**
 * classify(), plus the referent for a short follow-up: "how far is it?"
 * after an answer about a stop asks about that stop, and keeps the same
 * subject ("after that" stays the stop after next).
 */
function classifyWithContext(
  command: string,
  last: RoryLast | null,
): Classified {
  const t = normalise(command);
  if (last && ABOUT_A_STOP.has(last.intent)) {
    for (const [pattern, intent] of ELLIPTICAL) {
      if (pattern.test(t)) {
        const facility = intent === "facilities" ? namedFacility(t) : null;
        return { intent, facility, topic: null, subject: last.subject };
      }
    }
    // "Does it have toilets?": a named facility with no stop named.
    const facility = namedFacility(t);
    if (
      facility &&
      !has(t, "NEXT", "STOP", "BREAK", "REST", "DESTINATION", "AFTER")
    ) {
      return {
        intent: "facilities",
        facility,
        topic: null,
        subject: last.subject,
      };
    }
  }
  return classify(command);
}
