import { archivedSiteResponse } from "@/utils/archivedSite";
import * as site from "./pages.generated";

/**
 * Returns the archived Iteration 2 website on the plain addresses, while
 * ROOT_SITE in next.config.ts is "iteration2": routerest.app,
 * routerest.app/newjourney, routerest.app/route-breaks and so on.
 *
 * That build is kept in archive/iteration2-root (see its README), and is
 * separate from archive/iteration2 because it was built for the root
 * address rather than for /iteration2.
 *
 * Unlike the /iteration2 handler this one also returns the navigation
 * data Next fetches when a link is clicked (/index.txt,
 * /newjourney/__next._tree.txt and the like). Those are asked for at root
 * addresses, which next.config.ts rewrites here, and a rewrite can only
 * reach server code, never a file on the CDN.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug?: string[] }> },
) {
  const { slug } = await params;
  return archivedSiteResponse(slug, site);
}
