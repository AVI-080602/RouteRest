import type { NextConfig } from "next";

/**
 * Each iteration's website stays viewable under routerest.app:
 *
 *   routerest.app/iteration1/...  the website as it was at the end of
 *                                 Iteration 1 (up to 4 September 2026)
 *   routerest.app/iteration2/...  this website (Iteration 2)
 *   routerest.app/...             whichever one ROOT_SITE below names
 *
 * /iteration1 is served by this site itself, from the static copy in
 * archive/iteration1 (see its README, scripts/prepare-iteration1.mjs and
 * app/iteration1/[[...slug]]/route.ts). No rule is needed for it here.
 *
 * /iteration2 is this same site, so the rewrites below map it straight
 * back onto the root routes. They are rewrites, not redirects: the address
 * bar keeps /iteration2. Links and page changes inside the site go through
 * utils/appNavigation.tsx, which adds /iteration2 back to them when the
 * site was opened under it, so the driver stays on /iteration2 while
 * moving around. Its ITERATION2_PATH_PREFIX must match the sources below.
 * When Iteration 3 begins, /iteration2 can be archived the same way
 * /iteration1 is.
 */

/**
 * What plain routerest.app shows.
 *
 * "iteration1" until the Iteration 2 presentation: routerest.app,
 * routerest.app/newjourney and routerest.app/route-breaks show the
 * Iteration 1 website at those same addresses (see rootSiteRewrites).
 * Change this to "iteration2" afterwards and routerest.app is this
 * website again, with no other change needed. The "as" keeps both choices
 * open to TypeScript, so the checks below still compile after the value
 * changes.
 */
const ROOT_SITE = "iteration1" as "iteration1" | "iteration2";

/**
 * Rewrites that put the Iteration 1 website on the plain addresses.
 *
 * archive/iteration1 was built to live under /iteration1, so a second
 * build made for the root address is kept in archive/iteration1-root. Its
 * scripts and styles are public files under /iteration1-root/_next. Its
 * pages, and the navigation data Next fetches when a link is clicked
 * (/index.txt, /newjourney.txt, /newjourney/__next._tree.txt and so on),
 * are rewritten to app/iteration1-root/[[...slug]]/route.ts.
 *
 * These come before the /iteration2 rules, so they only ever match what
 * the browser asked for: /iteration2, which is rewritten to /, still shows
 * this website.
 */
function rootSiteRewrites() {
  if (ROOT_SITE !== "iteration1") {
    return [];
  }
  const pages = "newjourney|route-breaks|_not-found";
  return [
    { source: "/", destination: "/iteration1-root" },
    {
      source: "/:page(newjourney|route-breaks)",
      destination: "/iteration1-root/:page",
    },
    {
      source: "/:file(index\\.txt|__next\\..+\\.txt)",
      destination: "/iteration1-root/:file",
    },
    {
      source: `/:file((?:${pages})\\.txt)`,
      destination: "/iteration1-root/:file",
    },
    {
      source: `/:page(${pages})/:file(__next\\..+\\.txt)`,
      destination: "/iteration1-root/:page/:file",
    },
  ];
}

/**
 * While routerest.app shows Iteration 1, the pages that site never had
 * redirect to their /iteration2 copy, so a shared journey link
 * (routerest.app/share?j=...) or a bookmarked trip in progress
 * (routerest.app/navigate) still works. The query string is carried over.
 *
 * Temporary (307), never permanent: browsers remember a permanent
 * redirect, which would keep sending people away after ROOT_SITE changes
 * back.
 */
function rootSiteRedirects() {
  if (ROOT_SITE !== "iteration1") {
    return [];
  }
  return [
    {
      source:
        "/:page(state-check|navigate|after-rest|share|fatigue-monitoring)",
      destination: "/iteration2/:page",
      permanent: false,
    },
  ];
}

const nextConfig: NextConfig = {
  async redirects() {
    return rootSiteRedirects();
  },
  async rewrites() {
    return {
      // Before this site's own pages, so these paths are always served as
      // described above.
      beforeFiles: [
        ...rootSiteRewrites(),
        { source: "/iteration2", destination: "/" },
        { source: "/iteration2/:path*", destination: "/:path*" },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;
