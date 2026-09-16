import { Destination, JourneyDetails } from "@/types/journeyDetails";
import { shortenLocationLabel } from "@/utils/locationLabel";

/**
 * Turns a journey into a short piece of text that fits in a QR code, and
 * back again (US 1.4, continue a journey on another phone).
 *
 * Why a QR code and not the server: the project rule is that nothing
 * about a driver's trip is stored on our backend, not even anonymously
 * (see the Data Management Plan). A QR code hands the journey straight
 * from one phone to the other, so the data never leaves the two devices.
 *
 * The payload uses very short field names on purpose. A QR code holds
 * roughly 1,200 characters at the error-correction level we use, and a
 * multi-stop journey with full place labels gets close to that, so every
 * saved character buys room for another stop.
 *
 * The rest plan is deliberately NOT included. It is derived data: the
 * receiving phone asks the backend to recalculate it from the journey,
 * which keeps the code small and guarantees the plan matches the rules
 * the backend has seeded today.
 */

/** Bumped only if the payload shape changes in a way older apps cannot
 * read. The decoder refuses anything it does not recognise, rather than
 * guessing at fields that may have moved. */
export const SHARE_PAYLOAD_VERSION = 1;

/** A QR code at medium error correction tops out near 1,200 characters
 * in byte mode. Past that the scan becomes unreliable on a phone camera,
 * so we refuse to generate one and say why. */
export const MAX_QR_PAYLOAD_CHARS = 1200;

/** Coordinates are rounded to five decimal places, which is about one
 * metre. Routing cannot tell the difference, and it saves roughly ten
 * characters per point. */
function round5(value: number): number {
  return Math.round(value * 1e5) / 1e5;
}

type SharedStop = {
  /** Label, the full geocoder text so the other phone shows the same name. */
  l: string;
  /** Latitude and longitude, present for every stop the form added. */
  a?: number;
  o?: number;
  /** State name, used for the WA and NT jurisdiction rules. */
  s?: string;
};

type SharedJourney = {
  v: number;
  /** Departure label and coordinate. */
  dl: string;
  da?: number;
  do?: number;
  /** Stops in visiting order. */
  st: SharedStop[];
  /** Vehicle type, fuel type, remaining range in km. */
  vt: string;
  ft: string;
  fl: string;
  /** Departure and target arrival, as the form stores them. */
  dd: string;
  dt: string;
  ad: string;
  at: string;
  /** Co-driver, jurisdiction code, estimated driving hours. */
  cd: 0 | 1;
  jc: string;
  eh: string;
};

/**
 * Packs a journey into the text that goes inside the QR code.
 *
 * Throws when the result is too long to scan reliably, so the caller can
 * tell the driver why instead of showing a QR code that no camera can
 * read.
 */
export function encodeJourneyForTransfer(details: JourneyDetails): string {
  // Place names are the bulk of the payload, and the full geocoder text
  // ("Woolworths, Bourke Street, Melbourne, Victoria, 3000, Australia")
  // is mostly detail the other phone does not need: the coordinates do
  // the routing, and the app shows the short form everywhere anyway.
  // Packing the short form keeps a multi-stop journey inside a code a
  // camera can still read.
  const payload: SharedJourney = {
    v: SHARE_PAYLOAD_VERSION,
    dl: shortenLocationLabel(details.departureLocation),
    da: details.departureCoordinate
      ? round5(details.departureCoordinate.lat)
      : undefined,
    do: details.departureCoordinate
      ? round5(details.departureCoordinate.lng)
      : undefined,
    st: details.destination.map((stop) => ({
      l: shortenLocationLabel(stop.label),
      a: stop.lat !== undefined ? round5(stop.lat) : undefined,
      o: stop.lng !== undefined ? round5(stop.lng) : undefined,
      ...(stop.state ? { s: stop.state } : {}),
    })),
    vt: details.vehicleType,
    ft: details.fuelType,
    fl: details.fuelLevel,
    dd: details.departureDate,
    dt: details.departureTime,
    ad: details.arrivalDate,
    at: details.arrivalTime,
    cd: details.hasCoDriver ? 1 : 0,
    jc: details.jurisdictionCode,
    eh: details.estimatedDrivingHours,
  };

  // JSON.stringify drops keys whose value is undefined, so a journey with
  // no coordinates simply has fewer fields rather than nulls.
  const text = JSON.stringify(payload);

  if (text.length > MAX_QR_PAYLOAD_CHARS) {
    throw new Error(
      `This journey is too long to share as a code (${text.length} characters, limit ${MAX_QR_PAYLOAD_CHARS}). Remove a stop and try again.`,
    );
  }

  return text;
}

/** True when the value is a string, used to check scanned data field by
 * field rather than trusting the shape of whatever was scanned. */
function asString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`Scanned journey is missing its ${field}.`);
  }
  return value;
}

/**
 * Reads the text from a scanned QR code back into a journey.
 *
 * Everything scanned is treated as untrusted input: a QR code can contain
 * anything at all, including text from a completely different app. Each
 * field is checked, and anything unexpected raises an error the page can
 * show, rather than a half-filled journey that breaks later.
 */
export function decodeJourneyFromTransfer(text: string): JourneyDetails {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("That code is not a RouteRest journey.");
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("That code is not a RouteRest journey.");
  }

  const payload = parsed as Partial<SharedJourney>;

  if (payload.v !== SHARE_PAYLOAD_VERSION) {
    throw new Error(
      "That code was made by a different version of RouteRest. Update both phones and try again.",
    );
  }

  if (!Array.isArray(payload.st)) {
    throw new Error("Scanned journey is missing its destinations.");
  }

  const destination: Destination[] = payload.st.map((stop, index) => {
    if (typeof stop !== "object" || stop === null) {
      throw new Error(`Scanned journey has a bad stop at position ${index + 1}.`);
    }
    return {
      // A fresh id on this device: ids only need to be unique locally,
      // they are never compared between phones.
      id: crypto.randomUUID(),
      label: asString(stop.l, `stop ${index + 1} name`),
      ...(typeof stop.a === "number" ? { lat: stop.a } : {}),
      ...(typeof stop.o === "number" ? { lng: stop.o } : {}),
      ...(typeof stop.s === "string" ? { state: stop.s } : {}),
    };
  });

  return {
    departureLocation: asString(payload.dl, "departure"),
    departureCoordinate:
      typeof payload.da === "number" && typeof payload.do === "number"
        ? { lat: payload.da, lng: payload.do }
        : null,
    destination,
    vehicleType: asString(payload.vt, "vehicle type"),
    fuelType: asString(payload.ft, "fuel type"),
    fuelLevel: asString(payload.fl, "remaining range"),
    departureDate: asString(payload.dd, "departure date"),
    departureTime: asString(payload.dt, "departure time"),
    arrivalDate: asString(payload.ad, "arrival date"),
    arrivalTime: asString(payload.at, "arrival time"),
    hasCoDriver: payload.cd === 1,
    jurisdictionCode: asString(payload.jc, "jurisdiction"),
    estimatedDrivingHours: asString(payload.eh, "driving hours"),
  };
}

/** The query parameter a shared link carries the journey in. */
export const SHARE_LINK_PARAM = "j";

/** Base64url, the URL-safe alphabet: a plain base64 string would need
 * escaping inside a link, which makes the QR code bigger. */
function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): string {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/**
 * Builds the link that goes inside the QR code.
 *
 * A link rather than raw data on purpose: a phone's ordinary camera app
 * recognises a URL and offers to open it, which takes the other driver
 * straight into RouteRest with the journey ready to load. Raw data would
 * only show as text, and would need our own scanner to be open first.
 *
 * `origin` is the site the code was made on, so a code made on the
 * deployed site opens the deployed site. A code made on a laptop at
 * localhost only opens on that same machine, which is expected.
 */
export function encodeJourneyToShareUrl(
  details: JourneyDetails,
  origin: string,
): string {
  const url = `${origin}/share?${SHARE_LINK_PARAM}=${toBase64Url(encodeJourneyForTransfer(details))}`;
  if (url.length > MAX_QR_PAYLOAD_CHARS) {
    throw new Error(
      `This journey is too long to share as a code (${url.length} characters, limit ${MAX_QR_PAYLOAD_CHARS}). Remove a stop and try again.`,
    );
  }
  return url;
}

/**
 * Reads whatever a scan or a paste produced: a RouteRest link, the
 * packed text from inside one, or the plain journey text an older
 * version of the app produced. Anything else raises a clear error.
 */
export function decodeSharedJourneyText(text: string): JourneyDetails {
  const trimmed = text.trim();

  // A full link, which is what the QR code now contains.
  if (/^https?:\/\//i.test(trimmed)) {
    let packed: string | null = null;
    try {
      packed = new URL(trimmed).searchParams.get(SHARE_LINK_PARAM);
    } catch {
      throw new Error("That code is not a RouteRest journey.");
    }
    if (!packed) {
      throw new Error("That link does not carry a journey.");
    }
    return decodeJourneyFromTransfer(fromBase64Url(packed));
  }

  // The raw journey text, from an older code or pasted by hand.
  if (trimmed.startsWith("{")) {
    return decodeJourneyFromTransfer(trimmed);
  }

  // Just the packed part of a link, for example pasted without the
  // address around it.
  try {
    return decodeJourneyFromTransfer(fromBase64Url(trimmed));
  } catch {
    throw new Error("That code is not a RouteRest journey.");
  }
}

/** A short human summary of a scanned journey, shown for confirmation
 * before it replaces whatever is on this phone. */
export function describeJourney(details: JourneyDetails): string {
  const stopCount = details.destination.length;
  const last = details.destination[stopCount - 1];
  return `${details.departureLocation} to ${last ? last.label : "no destination"}, ${stopCount} stop${stopCount === 1 ? "" : "s"}, leaving ${details.departureDate} at ${details.departureTime}`;
}
