import type { NextConfig } from "next";

/**
 * This branch is the frozen Iteration 1 website (everything up to
 * 4 September 2026). It is shown at routerest.app/iteration1.
 *
 * It is not deployed on its own. Instead it is built once as plain static
 * files, and those files are kept in the main site under
 * frontend/my-app/archive/iteration1/, which serves them at /iteration1
 * (see archive/iteration1/README.md on main for the exact build steps).
 *
 * Two settings make that work:
 *
 *   basePath "/iteration1"  every page, link (Next's Link and router.push
 *                           add the prefix automatically) and /_next/static
 *                           file of this site carries /iteration1, so it
 *                           never collides with the main site's own files.
 *
 *   output "export"         the build produces static HTML, JavaScript and
 *                           the small .txt files Next uses for client-side
 *                           navigation, instead of a server app. A separate
 *                           Amplify deployment with basePath did not work:
 *                           Amplify serves a Next.js app's /_next/static
 *                           files without the prefix and dropped two of
 *                           this site's script files, so its pages loaded
 *                           but nothing on them worked.
 *
 * These are the only changes made to the Iteration 1 code after
 * 4 September.
 */
const nextConfig: NextConfig = {
  basePath: "/iteration1",
  output: "export",
};

export default nextConfig;
