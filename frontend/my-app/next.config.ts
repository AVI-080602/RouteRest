import type { NextConfig } from "next";

/**
 * Each iteration's website stays viewable under routerest.app:
 *
 *   routerest.app/iteration1/...  the website as it was at the end of
 *                                 Iteration 1 (up to 4 September 2026)
 *   routerest.app/iteration2/...  this website (Iteration 2)
 *   routerest.app/...             also this website, for now
 *
 * /iteration1 is served by this site itself, from the static copy in
 * archive/iteration1 (see its README, scripts/prepare-iteration1.mjs and
 * app/iteration1/[[...slug]]/route.ts). No rule is needed for it here.
 *
 * /iteration2 is this same site, so the rules below map it straight back
 * onto the root routes. They are rewrites, not redirects: the address bar
 * keeps /iteration2 on the page that was opened. Links inside the site
 * point at root addresses (for example /newjourney), which is the same
 * website. When Iteration 3 begins, /iteration2 can be archived the same
 * way /iteration1 is.
 */
const nextConfig: NextConfig = {
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
