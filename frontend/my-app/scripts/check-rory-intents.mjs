/**
 * Checks Rory's understanding rules (utils/roryIntents.ts) against real
 * transcripts.
 *
 * The first "heard" sentences are text the speech engine actually
 * produced on 7 and 11 October 2026 from recorded questions, clean and
 * with engine-like rumble mixed in, including its many spellings of
 * "Rory" and its mishearings of ordinary words ("few" for "fuel",
 * "stopped" for "stop"). Then come the many ways drivers phrase the same
 * questions, follow-up questions without the wake phrase, sentences that
 * must NOT wake Rory (cab conversation, the radio, names that sound
 * close), and the echo guard that drops the app's own voice.
 *
 * Run: node scripts/check-rory-intents.mjs   (Node 22.18 or later can
 * import the TypeScript file directly). Exits 1 if any case fails.
 */
import { parseSentence, stripEcho, words } from "../utils/roryIntents.ts";

const CASES = [
  // ---- Heard by the engine from the recorded questions.
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
    intent: "unavailable",
    topic: "weather",
  },
  {
    heard: "HEORI WHAT IS THE WEATHER LIKE INSIDNEY",
    addressed: true,
    intent: "unavailable",
    topic: "weather",
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
  { heard: "HEY RORY BE QUIET", addressed: true, intent: "hush" },
  { heard: "HEYROI BE QUIET", addressed: true, intent: "hush" },

  // The fuel question that got "I can't help" on 11 October 2026, in the
  // forms the engine produces for it.
  {
    heard: "HEY RORY WHICH IS THE NEXT FUEL STOP",
    addressed: true,
    intent: "fuel",
  },
  {
    heard: "HEY RORY WHICH IS THE NEXT FEW STOP",
    addressed: true,
    intent: "fuel",
  },
  {
    heard: "HEY RORY WHICH IS THE NEXT FEEL STOP",
    addressed: true,
    intent: "fuel",
  },
  {
    heard: "HEY RORY WHICH IS THE NEXT FULL STOPPED",
    addressed: true,
    intent: "fuel",
  },
  {
    heard: "HEY RORY WHERE CAN I GET FEW",
    addressed: true,
    intent: "find-fuel",
  },
  { heard: "HEY RORY WHERE'S THE NEXT SERVO", addressed: true, intent: "fuel" },
  // 12 October 2026: heard correctly, but answered about the planned stop
  // instead of searching. A request to go and get fuel is a search.
  {
    heard: "HEY RORY FIND ME NEAREST FUEL STATION",
    addressed: true,
    intent: "find-fuel",
  },
  {
    heard: "HEY RORY FIND ME THE NEAREST REST STOP WHERE I CAN GET FUEL",
    addressed: true,
    intent: "find-fuel",
  },
  {
    heard: "HEY RORY FIND ME A REST STOP WITH FUEL",
    addressed: true,
    intent: "find-fuel",
  },
  { heard: "HEY RORY NEAREST SERVO", addressed: true, intent: "find-fuel" },
  { heard: "HEY RORY I NEED DIESEL", addressed: true, intent: "find-fuel" },
  {
    heard: "HEY RORY I'M RUNNING LOW ON FUEL",
    addressed: true,
    intent: "find-fuel",
  },
  { heard: "HEY RORY FIND FUEL", addressed: true, intent: "find-fuel" },
  {
    heard: "FIND FUEL",
    expecting: "follow-up",
    last: { intent: "fuel", subject: "next" },
    addressed: true,
    intent: "find-fuel",
  },
  {
    heard: "HEY RORY IS THERE FUEL AT MY NEXT STOP",
    addressed: true,
    intent: "fuel",
  },
  {
    heard: "HEY RORY DO I HAVE ENOUGH FUEL",
    addressed: true,
    intent: "fuel",
    topic: "level",
  },
  {
    heard: "HEY RORY DO I NEED FUEL",
    addressed: true,
    intent: "fuel",
    topic: "level",
  },
  {
    heard: "HEY RORY HOW MUCH FUEL HAVE I GOT LEFT",
    addressed: true,
    intent: "fuel",
    topic: "level",
  },
  {
    heard: "HEY RORY HOW MUCH IS DIESEL",
    addressed: true,
    intent: "unavailable",
    topic: "prices",
  },

  // 12 October 2026 test drive, second round. "Find me a toilet" is a
  // search; asking about the next stop is still a question about it.
  {
    heard: "HEY RORY FIND ME A TOILET",
    addressed: true,
    intent: "find-rest-stop",
    facility: "TOILETS",
  },
  {
    heard: "HEY RORY WHERE ARE THE TOILETS",
    addressed: true,
    intent: "find-rest-stop",
    facility: "TOILETS",
  },
  {
    heard: "HEY RORY I NEED THE BATHROOM",
    addressed: true,
    intent: "find-rest-stop",
    facility: "TOILETS",
  },
  {
    heard: "HEY RORY NEAREST TOILETS",
    addressed: true,
    intent: "find-rest-stop",
    facility: "TOILETS",
  },
  {
    heard: "HEY RORY ARE THERE TOILETS AT MY NEXT STOP",
    addressed: true,
    intent: "facilities",
    facility: "TOILETS",
  },
  {
    heard: "HEY RORY FIND ME A SHOWER",
    addressed: true,
    intent: "facilities",
    facility: "SHOWERS",
  },
  // Changing the order of the stops.
  {
    heard: "HEY RORY I NEED TO REFUEL FIRST",
    addressed: true,
    intent: "reorder-stops",
    topic: "fuel",
  },
  {
    heard: "HEY RORY GO TO THE FUEL TOP FIRST",
    addressed: true,
    intent: "reorder-stops",
    topic: "fuel",
  },
  {
    heard: "HEY RORY REFUEL FIRST",
    addressed: true,
    intent: "reorder-stops",
    topic: "fuel",
  },
  {
    heard: "HEY RORY I WANT TO FUEL UP BEFORE I SLEEP",
    addressed: true,
    intent: "reorder-stops",
    topic: "fuel",
  },
  {
    heard: "HEY RORY REST FIRST",
    addressed: true,
    intent: "reorder-stops",
    topic: "rest",
  },
  {
    heard: "HEY RORY SWAP THE STOPS",
    addressed: true,
    intent: "reorder-stops",
    topic: "swap",
  },
  {
    heard: "HEY RORY CHANGE THE ORDER",
    addressed: true,
    intent: "reorder-stops",
    topic: "swap",
  },
  {
    heard: "I NEED TO REFUEL FIRST",
    expecting: "follow-up",
    last: { intent: "find-rest-stop", subject: "next" },
    addressed: true,
    intent: "reorder-stops",
    topic: "fuel",
  },
  {
    heard: "HEY RORY WHERE IS MY FIRST STOP",
    addressed: true,
    intent: "next-stop",
  },
  // "stop" heard as "top", but "top up" is fuel.
  {
    heard: "HEY RORY WHERE IS MY NEXT TOP",
    addressed: true,
    intent: "next-stop",
  },
  { heard: "HEY RORY THE NEXT TOP", addressed: true, intent: "next-stop" },
  { heard: "HEY RORY TOP", addressed: true, intent: "hush" },
  { heard: "HEY RORY TOP TALKING", addressed: true, intent: "hush" },
  { heard: "HEY RORY I NEED TO TOP UP", addressed: true, intent: "find-fuel" },

  // ---- Answers to Rory's yes or no question, with and without the wake word.
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
    heard: "GO FOR IT",
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

  // ---- "Hey Rory" on its own, then the question as the next sentence.
  { heard: "HEY RORY", addressed: true, intent: null },
  {
    heard: "HOW FAR TO GO",
    expecting: "command",
    addressed: true,
    intent: "distance",
  },

  // ---- Question forms the old rules missed.
  {
    heard: "HEY RORY WHICH IS THE NEXT STOP",
    addressed: true,
    intent: "next-stop",
  },
  {
    heard: "HEY RORY WHAT'S MY NEXT STOP",
    addressed: true,
    intent: "next-stop",
  },
  {
    heard: "HEY RORY WHATS MY NEXT STOP",
    addressed: true,
    intent: "next-stop",
  },
  {
    heard: "HEY RORY TELL ME MY NEXT REST STOP",
    addressed: true,
    intent: "next-stop",
  },
  {
    heard: "HEY RORY WHAT'S THE NAME OF THE STOP",
    addressed: true,
    intent: "next-stop",
  },
  { heard: "HEY RORY WHAT'S COMING UP", addressed: true, intent: "next-stop" },
  {
    heard: "HEY RORY WHERE DO I STOP NEXT",
    addressed: true,
    intent: "next-stop",
  },
  {
    heard: "HEY RORY WHEN IS MY NEXT BREAK",
    addressed: true,
    intent: "next-break-time",
  },
  {
    heard: "HEY RORY HOW LONG UNTIL MY NEXT STOP",
    addressed: true,
    intent: "next-break-time",
  },
  {
    heard: "HEY RORY HOW LONG TILL I CAN STOP",
    addressed: true,
    intent: "next-break-time",
  },
  {
    heard: "HEY RORY WHEN CAN I TAKE A BREAK",
    addressed: true,
    intent: "next-break-time",
  },
  {
    heard: "HEY RORY HOW SOON IS MY NEXT REST",
    addressed: true,
    intent: "next-break-time",
  },
  {
    heard: "HEY RORY HOW MANY STOPS LEFT",
    addressed: true,
    intent: "stops-remaining",
  },
  {
    heard: "HEY RORY HOW MANY MORE BREAKS DO I HAVE",
    addressed: true,
    intent: "stops-remaining",
  },
  {
    heard: "HEY RORY WHAT ARE MY STOPS",
    addressed: true,
    intent: "stops-remaining",
  },
  {
    heard: "HEY RORY WHAT'S THE PLAN",
    addressed: true,
    intent: "stops-remaining",
  },
  {
    heard: "HEY RORY HOW MUCH REST DO I HAVE LEFT",
    addressed: true,
    intent: "rest-ahead",
  },
  {
    heard: "HEY RORY HOW LONG IS MY NEXT BREAK",
    addressed: true,
    intent: "rest-ahead",
  },
  {
    heard: "HEY RORY HOW LONG DO I REST AT THE NEXT STOP",
    addressed: true,
    intent: "rest-ahead",
  },
  {
    heard: "HEY RORY WHAT'S AFTER THAT",
    addressed: true,
    intent: "next-stop",
    subject: "after",
  },
  {
    heard: "HEY RORY WHAT'S THE STOP AFTER NEXT",
    addressed: true,
    intent: "next-stop",
    subject: "after",
  },
  {
    heard: "HEY RORY IS THERE FUEL AT THE ONE AFTER",
    addressed: true,
    intent: "fuel",
    subject: "after",
  },
  {
    heard: "HEY RORY WHERE AM I GOING",
    addressed: true,
    intent: "destination",
  },
  {
    heard: "HEY RORY WHAT'S MY DESTINATION",
    addressed: true,
    intent: "destination",
  },
  {
    heard: "HEY RORY WHERE DOES THIS TRIP END",
    addressed: true,
    intent: "destination",
  },
  { heard: "HEY RORY WHERE AM I", addressed: true, intent: "where-am-i" },
  {
    heard: "HEY RORY HOW FAR HAVE I COME",
    addressed: true,
    intent: "where-am-i",
  },
  {
    heard: "HEY RORY AM I ON THE RIGHT ROAD",
    addressed: true,
    intent: "where-am-i",
  },
  {
    heard: "HEY RORY HOW FAR HAVE I GOT TO GO",
    addressed: true,
    intent: "distance",
  },
  { heard: "HEY RORY HOW FAST AM I GOING", addressed: true, intent: "speed" },
  { heard: "HEY RORY WHAT'S MY SPEED", addressed: true, intent: "speed" },
  {
    heard: "HEY RORY WHAT'S THE SPEED LIMIT HERE",
    addressed: true,
    intent: "unavailable",
    topic: "road-info",
  },
  {
    heard: "HEY RORY HOW LONG HAVE I BEEN DRIVING",
    addressed: true,
    intent: "driving-duration",
  },
  {
    heard: "HEY RORY WHEN DID I LEAVE",
    addressed: true,
    intent: "driving-duration",
  },
  {
    heard: "HEY RORY WHAT TIME IS IT",
    addressed: true,
    intent: "current-time",
  },
  {
    heard: "HEY RORY WHAT'S THE TIME",
    addressed: true,
    intent: "current-time",
  },
  { heard: "HEY RORY WHAT DAY IS IT", addressed: true, intent: "current-time" },
  {
    heard: "HEY RORY HOW LONG IS THE WHOLE TRIP",
    addressed: true,
    intent: "trip-summary",
  },
  {
    heard: "HEY RORY GIVE ME A SUMMARY OF THE TRIP",
    addressed: true,
    intent: "trip-summary",
  },
  {
    heard: "HEY RORY HOW FAR AND HOW LONG IS MY TRIP",
    addressed: true,
    intent: "trip-summary",
  },
  {
    heard: "HEY RORY HOW LONG CAN I KEEP DRIVING",
    addressed: true,
    intent: "rest-rule",
  },
  {
    heard: "HEY RORY WHEN DO I LEGALLY HAVE TO STOP",
    addressed: true,
    intent: "rest-rule",
  },
  {
    heard: "HEY RORY HOW MANY HOURS CAN I DRIVE",
    addressed: true,
    intent: "rest-rule",
  },
  {
    heard: "HEY RORY IS THE CAMERA ON",
    addressed: true,
    intent: "camera-status",
  },
  {
    heard: "HEY RORY IS THE CAMERA STILL WATCHING",
    addressed: true,
    intent: "camera-status",
  },
  {
    heard: "HEY RORY WHAT WAS THAT BEEP",
    addressed: true,
    intent: "alert-explain",
  },
  {
    heard: "HEY RORY WHAT WAS THAT ALERT ABOUT",
    addressed: true,
    intent: "alert-explain",
  },
  {
    heard: "HEY RORY AM I OKAY TO DRIVE",
    addressed: true,
    intent: "fatigue-status",
  },
  {
    heard: "HEY RORY HOW AM I DOING",
    addressed: true,
    intent: "fatigue-status",
  },
  { heard: "HEY RORY I FEEL TIRED", addressed: true, intent: "find-rest-stop" },
  {
    heard: "HEY RORY I NEED TO PULL OVER",
    addressed: true,
    intent: "find-rest-stop",
  },
  {
    heard: "HEY RORY WHERE'S THE NEAREST REST AREA",
    addressed: true,
    intent: "find-rest-stop",
  },
  {
    heard: "HEY RORY IS THERE SOMEWHERE TO STOP NEAR HERE",
    addressed: true,
    intent: "find-rest-stop",
  },
  {
    heard: "HEY RORY DOES THE NEXT STOP HAVE A SHOWER",
    addressed: true,
    intent: "facilities",
    facility: "SHOWERS",
  },
  {
    heard: "HEY RORY CAN I GET A COFFEE AT THE NEXT STOP",
    addressed: true,
    intent: "facilities",
    facility: "FOOD",
  },
  {
    heard: "HEY RORY WHAT'S AT THE NEXT STOP",
    addressed: true,
    intent: "facilities",
    facility: null,
  },
  {
    heard: "HEY RORY IS THERE SOMEWHERE TO SIT",
    addressed: true,
    intent: "facilities",
    facility: "SEATING",
  },
  { heard: "HEY RORY WHICH WAY DO I GO", addressed: true, intent: "next-turn" },
  {
    heard: "HEY RORY WHAT'S THE NEXT TURN",
    addressed: true,
    intent: "next-turn",
  },
  { heard: "HEY RORY STOP TALKING", addressed: true, intent: "hush" },
  { heard: "HEY RORY STOP", addressed: true, intent: "hush" },
  { heard: "HEY RORY MUTE", addressed: true, intent: "mute" },
  { heard: "HEY RORY TURN THE VOICE OFF", addressed: true, intent: "mute" },
  { heard: "HEY RORY NEVER MIND", addressed: true, intent: "nevermind" },
  { heard: "HEY RORY THANKS", addressed: true, intent: "thanks" },
  { heard: "HEY RORY THANK YOU RORY", addressed: true, intent: "thanks" },
  {
    heard: "HEY RORY HELLO",
    addressed: true,
    intent: "greeting",
    topic: "hello",
  },
  {
    heard: "HEY RORY GOOD MORNING",
    addressed: true,
    intent: "greeting",
    topic: "morning",
  },
  {
    heard: "HEY RORY HOW ARE YOU",
    addressed: true,
    intent: "greeting",
    topic: "how-are-you",
  },
  { heard: "HEY RORY WHO ARE YOU", addressed: true, intent: "identity" },
  { heard: "HEY RORY CAN YOU HEAR ME", addressed: true, intent: "identity" },
  {
    heard: "HEY RORY IS IT GOING TO RAIN",
    addressed: true,
    intent: "unavailable",
    topic: "weather",
  },
  {
    heard: "HEY RORY HOW'S THE TRAFFIC AHEAD",
    addressed: true,
    intent: "unavailable",
    topic: "traffic",
  },
  {
    heard: "HEY RORY PLAY SOME MUSIC",
    addressed: true,
    intent: "unavailable",
    topic: "music",
  },
  {
    heard: "HEY RORY CALL THE DEPOT",
    addressed: true,
    intent: "unavailable",
    topic: "calls",
  },
  {
    heard: "HEY RORY TELL ME A JOKE",
    addressed: true,
    intent: "unavailable",
    topic: "entertainment",
  },
  {
    heard: "HEY RORY WHAT'S THE FOOTY SCORE",
    addressed: true,
    intent: "unavailable",
    topic: "news",
  },
  {
    heard: "HEY RORY HOW IS THE LOAD GOING",
    addressed: true,
    intent: "unavailable",
    topic: "load",
  },
  {
    heard: "HEY RORY GREAT OCEAN ROAD",
    addressed: true,
    intent: "unsupported",
  },
  { heard: "HEY RORY BLAH BLAH BLAH", addressed: true, intent: "unsupported" },

  // ---- More phrasings drivers use.
  { heard: "HEY RORY HOW FAR TO GO", addressed: true, intent: "distance" },
  {
    heard: "HEY RORY HOW MANY KILOMETRES LEFT",
    addressed: true,
    intent: "distance",
  },
  {
    heard: "HEY RORY HOW MANY KAYS TO GO",
    addressed: true,
    intent: "distance",
  },
  { heard: "HEY RORY HOW MUCH FURTHER", addressed: true, intent: "distance" },
  { heard: "HEY RORY WHEN WILL I ARRIVE", addressed: true, intent: "time" },
  {
    heard: "HEY RORY WHAT TIME WILL I GET THERE",
    addressed: true,
    intent: "time",
  },
  { heard: "HEY RORY ARE WE THERE YET", addressed: true, intent: "time" },
  { heard: "HEY RORY HOW MUCH LONGER", addressed: true, intent: "time" },
  { heard: "HEY RORY HOW MANY HOURS LEFT", addressed: true, intent: "time" },
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
    heard: "HEY RORY ARE THERE TABLES AT THE NEXT STOP",
    addressed: true,
    intent: "facilities",
    facility: "SEATING",
  },
  { heard: "HEY RORY DISMISS", addressed: true, intent: "dismiss" },
  { heard: "HEY RORY GOT IT", addressed: true, intent: "dismiss" },
  { heard: "HEY RORY I'M AWAKE", addressed: true, intent: "dismiss" },
  {
    heard: "HEY RORY TURN THE CAMERA OFF",
    addressed: true,
    intent: "camera-off",
  },
  { heard: "HEY RORY CAMERA ON", addressed: true, intent: "camera-on" },
  {
    heard: "HEY RORY SWITCH THE CAMERA ON",
    addressed: true,
    intent: "camera-on",
  },
  { heard: "HEY RORY REROUTE", addressed: true, intent: "reroute" },
  { heard: "HEY RORY RE ROOT", addressed: true, intent: "reroute" },
  {
    heard: "HEY RORY GET ME BACK ON ROUTE",
    addressed: true,
    intent: "reroute",
  },
  { heard: "HEY RORY VOICE ON", addressed: true, intent: "unmute" },
  { heard: "HEY RORY WHAT CAN YOU DO", addressed: true, intent: "help" },
  {
    heard: "HEY RORY END THE JOURNEY",
    addressed: true,
    intent: "end-navigation",
  },
  {
    heard: "HEY RORY CANCEL NAVIGATION",
    addressed: true,
    intent: "end-navigation",
  },
  { heard: "HEY RORY I'M PARKED", addressed: true, intent: "arrived" },

  // ---- Follow-ups in the seconds after an answer, without the wake phrase.
  {
    heard: "DOES IT HAVE TOILETS",
    expecting: "follow-up",
    last: { intent: "next-stop", subject: "next" },
    addressed: true,
    intent: "facilities",
    facility: "TOILETS",
    subject: "next",
  },
  {
    heard: "HOW FAR IS IT",
    expecting: "follow-up",
    last: { intent: "next-stop", subject: "next" },
    addressed: true,
    intent: "next-break-time",
    subject: "next",
  },
  {
    heard: "AND FUEL",
    expecting: "follow-up",
    last: { intent: "next-stop", subject: "after" },
    addressed: true,
    intent: "fuel",
    subject: "after",
  },
  {
    heard: "WHAT'S THERE",
    expecting: "follow-up",
    last: { intent: "next-stop", subject: "next" },
    addressed: true,
    intent: "facilities",
    facility: null,
  },
  {
    heard: "AND AFTER THAT",
    expecting: "follow-up",
    last: { intent: "next-stop", subject: "next" },
    addressed: true,
    intent: "next-stop",
    subject: "after",
  },
  {
    heard: "HOW MUCH LONGER",
    expecting: "follow-up",
    last: { intent: "distance", subject: "next" },
    addressed: true,
    intent: "time",
  },
  {
    heard: "FIND A REST STOP",
    expecting: "follow-up",
    last: { intent: "fatigue-status", subject: "next" },
    addressed: true,
    intent: "find-rest-stop",
  },
  {
    heard: "STOP",
    expecting: "follow-up",
    last: { intent: "help", subject: "next" },
    addressed: true,
    intent: "hush",
  },
  // Without the wake phrase, nothing that changes the journey is accepted...
  {
    heard: "END NAVIGATION",
    expecting: "follow-up",
    last: { intent: "time", subject: "next" },
    addressed: false,
  },
  {
    heard: "TURN THE CAMERA OFF",
    expecting: "follow-up",
    last: { intent: "time", subject: "next" },
    addressed: false,
  },
  {
    heard: "REROUTE",
    expecting: "follow-up",
    last: { intent: "time", subject: "next" },
    addressed: false,
  },
  // ...and nor is talk to a passenger.
  {
    heard: "THANKS MATE",
    expecting: "follow-up",
    last: { intent: "time", subject: "next" },
    addressed: false,
  },
  {
    heard: "HELLO",
    expecting: "follow-up",
    last: { intent: "time", subject: "next" },
    addressed: false,
  },
  {
    heard: "SHE SAID SHE WOULD RING LATER",
    expecting: "follow-up",
    last: { intent: "time", subject: "next" },
    addressed: false,
  },
  // "How far is it" with nothing to refer to is the distance to go.
  {
    heard: "HOW FAR IS IT",
    expecting: "follow-up",
    last: { intent: "time", subject: "next" },
    addressed: true,
    intent: "distance",
  },

  // ---- Must not wake Rory.
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
  { heard: "HOW FAR IS IT TO THE SERVO", addressed: false },
  { heard: "DOES IT HAVE TOILETS", addressed: false },
];

// What the microphone heard while the app was talking, and what the
// driver actually said (null when it was all the app's own voice).
const ECHO_CASES = [
  {
    app: "Say Hey Rory, find a rest stop, to find the nearest one.",
    heard: "SAY HEY RORY FIND A REST STOP TO FIND THE NEAREST ONE",
    driver: null,
  },
  {
    app: "Your eyes have been closed for a while. Say Hey Rory, find a rest stop, to find the nearest one.",
    heard: "HEY RORY FIND A REST STOP",
    driver: null,
  },
  {
    app: "Your next rest stop is Glenrowan, 42 kilometres ahead. You have 30 minutes of rest planned there.",
    heard: "YOUR NEXT REST STOP IS GLEN ROWAN 42 KILOMETRES AHEAD",
    driver: null,
  },
  {
    app: "Your next rest stop is Glenrowan, 42 kilometres ahead. You have 30 minutes of rest planned there.",
    heard: "KILOMETRES AHEAD YOU HAVE HEY RORY HOW FAR TO GO",
    driver: "HEY RORY HOW FAR TO GO",
  },
  {
    app: "Your next rest stop is Glenrowan, 42 kilometres ahead. You have 30 minutes of rest planned there.",
    heard: "HEY RORY HOW FAR TO GO",
    driver: "HEY RORY HOW FAR TO GO",
  },
  {
    app: "Your next rest stop is Glenrowan, 42 kilometres ahead.",
    heard: "HEY RORY IS THERE FUEL AT THE NEXT STOP",
    driver: "HEY RORY IS THERE FUEL AT THE NEXT STOP",
  },
  {
    app: "In 350 metres, turn left onto the Hume Highway.",
    heard: "HEY RORY WHERE DO I TURN",
    driver: "HEY RORY WHERE DO I TURN",
  },
  {
    app: "",
    heard: "HEY RORY HOW FAR TO GO",
    driver: "HEY RORY HOW FAR TO GO",
  },
];

let failures = 0;
for (const c of CASES) {
  const got = parseSentence(c.heard, c.expecting ?? null, c.last ?? null);
  const problems = [];
  if (got.addressed !== c.addressed)
    problems.push(`addressed ${got.addressed}`);
  if (c.intent !== undefined && got.intent !== c.intent)
    problems.push(`intent ${got.intent}`);
  if (c.facility !== undefined && got.facility !== c.facility)
    problems.push(`facility ${got.facility}`);
  if (c.topic !== undefined && got.topic !== c.topic)
    problems.push(`topic ${got.topic}`);
  if (c.subject !== undefined && got.subject !== c.subject)
    problems.push(`subject ${got.subject}`);
  if (problems.length > 0) {
    failures += 1;
    console.log(
      `FAIL  "${c.heard}"${c.expecting ? ` (${c.expecting})` : ""}  expected ${c.addressed ? (c.intent ?? "(wake only)") : "ignored"}, got ${problems.join(", ")}`,
    );
  }
}
for (const c of ECHO_CASES) {
  const got = stripEcho(words(c.heard), c.app);
  const text = got === null ? null : got.join(" ");
  if (text !== c.driver) {
    failures += 1;
    console.log(
      `FAIL  echo "${c.heard}"  expected ${JSON.stringify(c.driver)}, got ${JSON.stringify(text)}`,
    );
  }
}
const total = CASES.length + ECHO_CASES.length;
console.log(`${total - failures} of ${total} sentences understood as expected`);
process.exit(failures > 0 ? 1 : 0);
