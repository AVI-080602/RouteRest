/**
 * Responses for an archived website kept as static build output, such as
 * the Iteration 1 site (see scripts/prepare-iteration1.mjs, which writes
 * the pages.generated.ts module each route handler passes in here).
 */

/** What a generated pages module exports. */
export type ArchivedSite = {
  /** Page path without the leading slash ("" is the home page) -> HTML. */
  PAGES: Readonly<Record<string, string>>;
  /** Navigation data path -> contents, for builds that bundle it. */
  DATA: Readonly<Record<string, string>>;
  /** The archived site's own 404 page. */
  NOT_FOUND: string;
};

// The archive only changes with a new deployment, but a short cache keeps
// a redeploy visible straight away.
const CACHE_CONTROL = "public, max-age=0, must-revalidate";

/**
 * The page or navigation data file at `slug`, or the archived site's 404
 * page. Navigation data is sent as text/plain, which is what Next's client
 * accepts from a static build.
 */
export function archivedSiteResponse(
  slug: string[] | undefined,
  site: ArchivedSite,
): Response {
  const filePath = (slug ?? []).join("/");

  if (Object.hasOwn(site.PAGES, filePath)) {
    return new Response(site.PAGES[filePath], {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": CACHE_CONTROL,
      },
    });
  }

  if (Object.hasOwn(site.DATA, filePath)) {
    return new Response(site.DATA[filePath], {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": CACHE_CONTROL,
      },
    });
  }

  return new Response(site.NOT_FOUND, {
    status: 404,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": CACHE_CONTROL,
    },
  });
}
