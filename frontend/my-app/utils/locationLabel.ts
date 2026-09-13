/**
 * Shortens a geocoder display label for the UI (BA item 3).
 *
 * The backend's /geocode endpoint builds labels by joining up to six
 * Photon fields: name, street, city, state, postcode, country. That is
 * the right thing to STORE (it is what makes two "Woolworths" results
 * distinguishable), but far too long to show inside a 48px input, a
 * destination chip, or a map caption, e.g.
 *
 *   "Woolworths, Bourke Street, Melbourne, Victoria, 3000, Australia"
 *
 * becomes
 *
 *   "Woolworths, Melbourne, VIC"
 *
 * The full label stays in state and localStorage; callers put it in a
 * `title` attribute so it is still one hover away. This is a frontend-only
 * concern on purpose: a backend `short_label` field would have needed a
 * new response field, a new type field, and a fallback for journey drafts
 * already sitting in drivers' localStorage without it.
 */

const STATE_ABBREVIATIONS: Record<string, string> = {
  Victoria: "VIC",
  "New South Wales": "NSW",
  Queensland: "QLD",
  "South Australia": "SA",
  Tasmania: "TAS",
  "Australian Capital Territory": "ACT",
  "Western Australia": "WA",
  "Northern Territory": "NT",
};

const KNOWN_ABBREVIATIONS = new Set(Object.values(STATE_ABBREVIATIONS));

/** True for a comma-separated part that adds nothing for an Australian
 * driver: the country name, or a bare 4-digit postcode. */
const isNoisePart = (part: string) =>
  part === "Australia" || /^\d{4}$/.test(part);

/**
 * Returns "Name, Locality, STATE" when a state can be identified, and
 * otherwise the first three meaningful parts. Idempotent: feeding an
 * already-shortened label back in returns it unchanged, so it is safe to
 * call at render time on values that may have come from either source.
 */
export function shortenLocationLabel(label: string): string {
  const parts = label
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !isNoisePart(part));

  if (parts.length === 0) {
    return label.trim();
  }

  const stateIndex = parts.findIndex(
    (part) => part in STATE_ABBREVIATIONS || KNOWN_ABBREVIATIONS.has(part),
  );

  if (stateIndex === -1) {
    return parts.slice(0, 3).join(", ");
  }

  const name = parts[0];
  // The part immediately before the state is the locality (city/suburb)
  // whenever the geocoder supplied one. It is only worth repeating when
  // it differs from the name itself ("Melbourne, Melbourne, VIC" reads
  // badly).
  const locality = stateIndex > 1 ? parts[stateIndex - 1] : undefined;
  const state = STATE_ABBREVIATIONS[parts[stateIndex]] ?? parts[stateIndex];

  return [name, locality !== name ? locality : undefined, state]
    .filter((part): part is string => Boolean(part))
    .join(", ");
}
