/**
 * The backend limits how many routes one network may ask for, because the
 * routing service gives RouteRest a shared daily allowance (see
 * backend/src/backend/http_guards.py). When that limit is reached it
 * answers 429 with a message that says how long to wait, for example
 * "... Try again in about 7 hours."
 *
 * Pages that ask for a route show that message instead of their usual
 * "check your connection" or "check the stops". Added on 13 October 2026,
 * when a day of testing on a phone and a laptop sharing one home network
 * reached the limit and the website blamed the connection.
 */

/** The server's own message for a refused route request, or null for any other failure. */
export async function routeLimitMessage(
  response: Response,
): Promise<string | null> {
  if (response.status !== 429) {
    return null;
  }
  try {
    const body: unknown = await response.clone().json();
    const detail = (body as { detail?: unknown } | null)?.detail;
    if (typeof detail === "string" && detail.trim()) {
      return detail;
    }
  } catch {
    // No readable body: fall back to the general wording below.
  }
  return "Too many route requests from this network. Try again later.";
}

/** Thrown where a route function reports failure by throwing. */
export class RouteLimitError extends Error {}
