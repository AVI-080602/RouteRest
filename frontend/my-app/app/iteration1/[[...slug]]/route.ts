import { archivedSiteResponse } from "@/utils/archivedSite";
import * as site from "./pages.generated";

/**
 * Returns the pages of the archived Iteration 1 website at
 * routerest.app/iteration1, /iteration1/newjourney and
 * /iteration1/route-breaks.
 *
 * That site is kept as static build output in archive/iteration1 (see its
 * README). Its scripts, styles and navigation data are served straight
 * from public/iteration1/, but a request for /iteration1/newjourney does
 * not map to newjourney.html by itself, so this handler returns the right
 * page. Any other path under /iteration1 gets that site's own 404 page.
 *
 * Public files are matched before routes, so requests for
 * /iteration1/_next/... never reach this handler.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug?: string[] }> },
) {
  const { slug } = await params;
  return archivedSiteResponse(slug, site);
}
