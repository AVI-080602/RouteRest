import type { NextConfig } from "next";

/**
 * This branch is the frozen Iteration 1 website (everything up to
 * 4 September 2026). It is served at routerest.app/iteration1: the main
 * site forwards every request under /iteration1 to this branch's own
 * Amplify deployment (see next.config.ts on main).
 *
 * basePath makes this app live under /iteration1 instead of the root, so
 * its pages, its links (Next's Link and router.push add the prefix
 * automatically) and its /_next/static files all carry the prefix. Without
 * it, a page fetched through routerest.app/iteration1 would ask for its
 * scripts at routerest.app/_next/..., which belongs to the current site,
 * and the old page would break.
 *
 * This is the only change made to the Iteration 1 code after 4 September.
 */
const nextConfig: NextConfig = {
  basePath: "/iteration1",
};

export default nextConfig;
