/**
 * Checks Rory's understanding rules (utils/roryIntents.ts) against real
 * transcripts.
 *
 * Every "heard" sentence below is text the speech engine actually produced
 * on 7 October 2026 from recorded questions, clean and with engine-like
 * rumble mixed in, including its many spellings of "Rory". The rest are
 * sentences that must NOT wake Rory: cab conversation, the radio, names
 * that sound close.
 *
 * Run: node scripts/check-rory-intents.mjs   (Node 22.18 or later can
 * import the TypeScript file directly). Exits 1 if any case fails.
 */
import { parseSentence } from "../utils/roryIntents.ts";

const CASES = [
  // Heard by the engine from the recorded questions.
  {
    heard: "HEY RORY HOW FAR IS MY NEXT REST STOP",
    addressed: true,
    intent: "next-stop",
  },
  {
    heard: "AND HE RORY HOW FAR IS MY NEXT REST STOPPED",
    addressed: true,
    intent: "next-stop",
  },
  {
    heard: "HEY RORY HOW MUCH DRIVING TIME IS LEFT",
    addressed: true,
    intent: "time",
  },
  {
    heard: "HEYROI HOW MUCH DRIVING TIME IS LEFT",
    addressed: true,
    intent: "time",
  },
  {
    heard: "HE RORY HOW MUCH DRIVING TIME IS LEFT",
    addressed: true,
    intent: "time",
  },
  {
    heard: "HEY RORY WHY DID I GET THAT WARNING",
    addressed: true,
    intent: "alert-explain",
  },
  {
    heard: "HEYROE WHY DID I GET THAT WARNING",
    addressed: true,
    intent: "alert-explain",
  },
  {
    heard: "HEY RORY WHAT IS THE WEATHER LIKE IN SYDNEY",
    addressed: true,
    intent: "unsupported",
  },
  {
    heard: "HEORI WHAT IS THE WEATHER LIKE INSIDNEY",
    addressed: true,
    intent: "unsupported",
  },
  {
    heard: "HEY RORY IS THERE FUEL AT THE NEXT STOP",
    addressed: true,
    intent: "fuel",
  },
  {
    heard: "HEYORY IS THEIR FUEL AT THE NEXT STUFF",
    addressed: true,
    intent: "fuel",
  },
  { heard: "RORY WHERE'S MY NEXT BREAK", addressed: true, intent: "next-stop" },
  {
    heard: "HEY RORY HOW TIRED AM I",
    addressed: true,
    intent: "fatigue-status",
  },
  {
    heard: "NAY RORY HOW TIRED AM I",
    addressed: true,
    intent: "fatigue-status",
  },
  {
    heard: "HEY RORY FIND ME A REST STOP",
    addressed: true,
    intent: "find-rest-stop",
  },
  {
    heard: "HEYROY FIND ME A REST STOP",
    addressed: true,
    intent: "find-rest-stop",
  },
  {
    heard: "HEY RORY ARE THERE TOILETS AT THE NEXT STOP",
    addressed: true,
    intent: "facilities",
    facility: "TOILETS",
  },
  {
    heard: "KRORI ARE THERE TOILETS AT THE NEXT STOP",
    addressed: true,
    intent: "facilities",
    facility: "TOILETS",
  },
  {
    heard: "HE RORY ARE THEIR TOILETS AT THE NEXT STOP",
    addressed: true,
    intent: "facilities",
    facility: "TOILETS",
  },
  { heard: "HEY RORY I'VE ARRIVED", addressed: true, intent: "arrived" },
  { heard: "HEYROI I'VE ARRIVED", addressed: true, intent: "arrived" },
  { heard: "A RORY I'VE ARRIVED", addressed: true, intent: "arrived" },
  {
    heard: "HEYRORI AND NAVIGATION",
    addressed: true,
    intent: "end-navigation",
  },
  { heard: "HERORI AND NAVIGATION", addressed: true, intent: "end-navigation" },
  { heard: "HEORI AND NAVIGATION", addressed: true, intent: "end-navigation" },
  { heard: "HEY RORY SAY THAT AGAIN", addressed: true, intent: "repeat" },
  { heard: "PENRORY SAY THAT AGAIN", addressed: true, intent: "repeat" },
  { heard: "HEY RORY BE QUIET", addressed: true, intent: "mute" },
  { heard: "HEYROI BE QUIET", addressed: true, intent: "mute" },

  // Answers to Rory's yes or no question, with and without the wake word.
  {
    heard: "YES AT IT",
    expecting: "answer",
    addressed: true,
    intent: "confirm",
  },
  {
    heard: "YES ADDED",
    expecting: "answer",
    addressed: true,
    intent: "confirm",
  },
  {
    heard: "YES ADD IT",
    expecting: "answer",
    addressed: true,
    intent: "confirm",
  },
  {
    heard: "NO THANKS",
    expecting: "answer",
    addressed: true,
    intent: "decline",
  },
  {
    heard: "HEY RORY NO",
    expecting: "answer",
    addressed: true,
    intent: "decline",
  },
  // ...but a yes with nobody asking is just conversation.
  { heard: "YES ADD IT", addressed: false, intent: null },

  // "Hey Rory" on its own, then the question as the next sentence.
  { heard: "HEY RORY", addressed: true, intent: null },
  {
    heard: "HOW FAR TO GO",
    expecting: "command",
    addressed: true,
    intent: "distance",
  },

  // More phrasings drivers use.
  { heard: "HEY RORY HOW FAR TO GO", addressed: true, intent: "distance" },
  {
    heard: "HEY RORY HOW MANY KILOMETRES LEFT",
    addressed: true,
    intent: "distance",
  },
  { heard: "HEY RORY WHEN WILL I ARRIVE", addressed: true, intent: "time" },
  {
    heard: "HEY RORY WHAT TIME WILL I GET THERE",
    addressed: true,
    intent: "time",
  },
  { heard: "HEY RORY WHERE DO I TURN", addressed: true, intent: "next-turn" },
  { heard: "HEY RORY I'M TIRED", addressed: true, intent: "find-rest-stop" },
  {
    heard: "HEY RORY I NEED A BREAK",
    addressed: true,
    intent: "find-rest-stop",
  },
  {
    heard: "HEY RORY WHAT FACILITIES ARE AT THE NEXT STOP",
    addressed: true,
    intent: "facilities",
    facility: null,
  },
  {
    heard: "HEY RORY IS THERE A SHOWER",
    addressed: true,
    intent: "facilities",
    facility: "SHOWERS",
  },
  {
    heard: "HEY RORY IS THERE SOMEWHERE TO SIT",
    addressed: true,
    intent: "unsupported",
  },
  {
    heard: "HEY RORY ARE THERE TABLES AT THE NEXT STOP",
    addressed: true,
    intent: "facilities",
    facility: "SEATING",
  },
  { heard: "HEY RORY DISMISS", addressed: true, intent: "dismiss" },
  { heard: "HEY RORY GOT IT", addressed: true, intent: "dismiss" },
  {
    heard: "HEY RORY TURN THE CAMERA OFF",
    addressed: true,
    intent: "camera-off",
  },
  { heard: "HEY RORY CAMERA ON", addressed: true, intent: "camera-on" },
  { heard: "HEY RORY REROUTE", addressed: true, intent: "reroute" },
  { heard: "HEY RORY VOICE ON", addressed: true, intent: "unmute" },
  { heard: "HEY RORY WHAT CAN YOU DO", addressed: true, intent: "help" },
  {
    heard: "HEY RORY END THE JOURNEY",
    addressed: true,
    intent: "end-navigation",
  },
  { heard: "HEY RORY TELL ME A JOKE", addressed: true, intent: "unsupported" },
  // Contains AND and TRIP, but is a distance and time question.
  {
    heard: "HEY RORY HOW FAR AND HOW LONG IS MY TRIP",
    addressed: true,
    intent: "time",
  },

  // Must not wake Rory.
  { heard: "WE ARE MAKING GOOD TIME TODAY", addressed: false },
  {
    heard:
      "WE ARE JUST DRIVING ALONG THE HIGHWAY THE TRAFFIC IS LIGHT AND THE ROAD IS CLEAR",
    addressed: false,
  },
  { heard: "SORRY I MISSED THAT", addressed: false },
  { heard: "THE STORY ON THE RADIO", addressed: false },
  { heard: "ROY CALLED ME THIS MORNING", addressed: false },
  { heard: "I TOLD RORY ABOUT THE TRIP", addressed: false },
  { heard: "WORRY ABOUT IT LATER", addressed: false },
];

let failures = 0;
for (const c of CASES) {
  const got = parseSentence(c.heard, c.expecting ?? null);
  const problems = [];
  if (got.addressed !== c.addressed)
    problems.push(`addressed ${got.addressed}`);
  if (c.intent !== undefined && got.intent !== c.intent)
    problems.push(`intent ${got.intent}`);
  if (c.facility !== undefined && got.facility !== c.facility)
    problems.push(`facility ${got.facility}`);
  if (problems.length > 0) {
    failures += 1;
    console.log(
      `FAIL  "${c.heard}"  expected ${c.addressed ? (c.intent ?? "(wake only)") : "ignored"}, got ${problems.join(", ")}`,
    );
  }
}
console.log(
  `${CASES.length - failures} of ${CASES.length} sentences understood as expected`,
);
process.exit(failures > 0 ? 1 : 0);
