import { archivedSiteResponse } from "@/utils/archivedSite";
import * as site from "./pages.generated";

/**
 * Returns the Iteration 1 website for plain routerest.app, while ROOT_SITE
 * in next.config.ts is "iteration1".
 *
 * Nobody opens /iteration1-root directly: next.config.ts rewrites
 * routerest.app/, /newjourney and /route-breaks, and the navigation data
 * Next fetches for them (/index.txt, /newjourney/__next._tree.txt and so
 * on), to this handler, so the address bar keeps the plain address. The
 * pages and that data come from archive/iteration1-root, which was built
 * for the root address (see its README). Its scripts and styles are
 * public files under /iteration1-root/_next and never reach this handler.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug?: string[] }> },
) {
  const { slug } = await params;
  return archivedSiteResponse(slug, site);
}
