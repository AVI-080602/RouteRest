import type { NextConfig } from "next";

/**
 * Where the frozen Iteration 1 website runs: its own Amplify deployment,
 * built from the `iteration-1` branch with basePath "/iteration1".
 * Overridable with the ITERATION_1_ORIGIN environment variable (read at
 * build time), for example to point a local build at a local copy.
 */
const ITERATION_1_ORIGIN =
  process.env.ITERATION_1_ORIGIN ??
  "https://iteration-1.d1g2jjwkw45k5x.amplifyapp.com";

const nextConfig: NextConfig = {
  /**
   * Each iteration's website stays viewable under routerest.app:
   *
   *   routerest.app/iteration1/...  the website as it was at the end of
   *                                 Iteration 1 (up to 4 September 2026)
   *   routerest.app/iteration2/...  this website (Iteration 2)
   *   routerest.app/...             also this website, for now
   *
   * These are rewrites, not redirects: the address bar keeps /iteration1
   * or /iteration2 while the content comes from the right place.
   *
   * /iteration1 is forwarded to the Iteration 1 deployment. Because it is
   * served from routerest.app itself, the backend and the map key already
   * accept it, and nothing on the old site needed to change except its
   * basePath.
   *
   * /iteration2 is this same site, so it maps straight back onto the
   * root routes. Links inside the site point at root addresses (for
   * example /newjourney), which is the same website. When Iteration 3
   * begins, /iteration2 can be frozen the same way /iteration1 is.
   *
   * beforeFiles makes these rules run before this site looks for its own
   * pages, so /iteration1/... can never be answered by a page here.
   */
  async rewrites() {
    return {
      beforeFiles: [
        {
          source: "/iteration1",
          destination: `${ITERATION_1_ORIGIN}/iteration1`,
        },
        {
          source: "/iteration1/:path*",
          destination: `${ITERATION_1_ORIGIN}/iteration1/:path*`,
        },
        { source: "/iteration2", destination: "/" },
        { source: "/iteration2/:path*", destination: "/:path*" },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;
