import { Destination, JourneyDetails } from "@/types/journeyDetails";

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
  const payload: SharedJourney = {
    v: SHARE_PAYLOAD_VERSION,
    dl: details.departureLocation,
    da: details.departureCoordinate
      ? round5(details.departureCoordinate.lat)
      : undefined,
    do: details.departureCoordinate
      ? round5(details.departureCoordinate.lng)
      : undefined,
    st: details.destination.map((stop) => ({
      l: stop.label,
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

/** A short human summary of a scanned journey, shown for confirmation
 * before it replaces whatever is on this phone. */
export function describeJourney(details: JourneyDetails): string {
  const stopCount = details.destination.length;
  const last = details.destination[stopCount - 1];
  return `${details.departureLocation} to ${last ? last.label : "no destination"}, ${stopCount} stop${stopCount === 1 ? "" : "s"}, leaving ${details.departureDate} at ${details.departureTime}`;
}
