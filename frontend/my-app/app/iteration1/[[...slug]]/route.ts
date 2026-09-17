import { ITERATION1_NOT_FOUND, ITERATION1_PAGES } from "./pages.generated";

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
  const pagePath = (slug ?? []).join("/");
  const html = Object.hasOwn(ITERATION1_PAGES, pagePath)
    ? ITERATION1_PAGES[pagePath]
    : undefined;

  return new Response(html ?? ITERATION1_NOT_FOUND, {
    status: html === undefined ? 404 : 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // The archive only changes with a new deployment, but a short cache
      // keeps a redeploy visible straight away.
      "Cache-Control": "public, max-age=0, must-revalidate",
    },
  });
}
