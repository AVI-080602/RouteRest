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
 * "iteration1" until the Iteration 2 presentation: the root addresses
 * redirect to the Iteration 1 site (see rootRedirects). Change this to
 * "iteration2" afterwards and routerest.app is this website again, with
 * no other change needed. The "as" keeps both choices open to TypeScript,
 * so the check in rootRedirects still compiles after the value changes.
 */
const ROOT_SITE = "iteration1" as "iteration1" | "iteration2";

/**
 * Redirects for plain routerest.app addresses while it shows Iteration 1.
 *
 * The Iteration 1 site was built to live under /iteration1, so the root
 * addresses redirect there rather than showing it in place. Pages the
 * Iteration 1 site never had go to their /iteration2 copy instead, so a
 * shared journey link (routerest.app/share?j=...) or a bookmarked trip
 * in progress (routerest.app/navigate) still works. The query string is
 * carried over.
 *
 * Temporary (307), never permanent: browsers remember a permanent
 * redirect, which would keep sending people to Iteration 1 after
 * ROOT_SITE changes back.
 */
function rootRedirects() {
  if (ROOT_SITE !== "iteration1") {
    return [];
  }
  return [
    { source: "/", destination: "/iteration1", permanent: false },
    {
      source: "/:page(newjourney|route-breaks)",
      destination: "/iteration1/:page",
      permanent: false,
    },
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
    return rootRedirects();
  },
  async rewrites() {
    return {
      // Before this site's own pages, so these paths are always this site.
      beforeFiles: [
        { source: "/iteration2", destination: "/" },
        { source: "/iteration2/:path*", destination: "/:path*" },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;
