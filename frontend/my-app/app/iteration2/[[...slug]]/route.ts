import { archivedSiteResponse } from "@/utils/archivedSite";
import * as site from "./pages.generated";

/**
 * Returns the pages of the archived Iteration 2 website at
 * routerest.app/iteration2 and everything below it.
 *
 * That site is kept as static build output in archive/iteration2 (see its
 * README). Its scripts, styles and navigation data are served straight
 * from public/iteration2/, but a request for /iteration2/newjourney does
 * not map to newjourney.html by itself, so this handler returns the right
 * page. Any other path under /iteration2 gets that site's own 404 page.
 *
 * Public files are matched before routes, so requests for
 * /iteration2/_next/... never reach this handler.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug?: string[] }> },
) {
  const { slug } = await params;
  return archivedSiteResponse(slug, site);
}
