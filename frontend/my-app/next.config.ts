import type { NextConfig } from "next";

/**
 * Each iteration's website stays viewable under routerest.app:
 *
 *   routerest.app/iteration1/...  the website as it was at the end of
 *                                 Iteration 1 (up to 4 September 2026)
 *   routerest.app/iteration2/...  the website as it was at the end of
 *                                 Iteration 2 (up to 29 September 2026)
 *   routerest.app/iteration3/...  this website, the one being built
 *   routerest.app/...             whichever one ROOT_SITE below names
 *
 * A finished iteration is frozen: it is built to static files kept in
 * archive/, and served by this site from there (see each folder's README,
 * scripts/prepare-archives.mjs and app/iterationN/[[...slug]]/route.ts).
 * It never changes again, whatever happens to the code here.
 *
 * /iteration3 is this same site, so the rewrites below map it straight
 * back onto the root routes. They are rewrites, not redirects: the address
 * bar keeps /iteration3. Links and page changes inside the site go through
 * utils/appNavigation.tsx, which adds /iteration3 back to them when the
 * site was opened under it, so the driver stays on /iteration3 while
 * moving around. Its LIVE_PATH_PREFIX must match LIVE_PREFIX below.
 */

/** This website's own prefix while an older iteration is at the root. */
const LIVE_PREFIX = "/iteration3";

/**
 * Every page this website has, as its path segment. Used to work out
 * which pages the older site at the root cannot answer for (see
 * rootSiteRedirects), so a new page must be added here.
 */
const LIVE_PAGES = [
  "newjourney",
  "route-breaks",
  "state-check",
  "navigate",
  "after-rest",
  "share",
  "fatigue-monitoring",
] as const;

/**
 * The pages each archived website has. Fixed lists, not derived from
 * LIVE_PAGES: an archive is frozen, so it never gains a page this site
 * gains later.
 */
const ARCHIVE_PAGES: Record<string, readonly string[]> = {
  iteration1: ["newjourney", "route-breaks"],
  iteration2: [
    "newjourney",
    "route-breaks",
    "state-check",
    "navigate",
    "after-rest",
    "share",
    "fatigue-monitoring",
  ],
};

/**
 * What plain routerest.app shows.
 *
 * An iteration number means that frozen website answers the plain
 * addresses: routerest.app, routerest.app/newjourney and so on show it
 * (see rootSiteRewrites). "iteration3" means this website does, with no
 * rewriting at all, which is what this changes to after the Iteration 3
 * presentation. Nothing else needs changing when it does.
 */
const ROOT_SITE = "iteration2" as "iteration1" | "iteration2" | "iteration3";

/** The archived site at the root, or null while this website is there. */
const rootArchive = ROOT_SITE === "iteration3" ? null : ROOT_SITE;

/**
 * Rewrites that put an archived website on the plain addresses.
 *
 * An archive is built to live under its own prefix, so a second build
 * made for the root address is kept alongside it, for example
 * archive/iteration2-root. Its scripts and styles are public files under
 * /iteration2-root/_next. Its pages, and the navigation data Next fetches
 * when a link is clicked (/index.txt, /newjourney.txt,
 * /newjourney/__next._tree.txt and so on), are rewritten to
 * app/iteration2-root/[[...slug]]/route.ts.
 *
 * These come before the prefix rules, so they only ever match what the
 * browser asked for: /iteration3, which is rewritten to /, still shows
 * this website.
 */
function rootSiteRewrites() {
  if (!rootArchive) {
    return [];
  }
  const root = `/${rootArchive}-root`;
  const pageNames = ARCHIVE_PAGES[rootArchive].join("|");
  const withNotFound = `${pageNames}|_not-found`;
  return [
    { source: "/", destination: root },
    { source: `/:page(${pageNames})`, destination: `${root}/:page` },
    {
      source: "/:file(index\.txt|__next\..+\.txt)",
      destination: `${root}/:file`,
    },
    {
      source: `/:file((?:${withNotFound})\.txt)`,
      destination: `${root}/:file`,
    },
    {
      source: `/:page(${withNotFound})/:file(__next\..+\.txt)`,
      destination: `${root}/:page/:file`,
    },
  ];
}

/**
 * The pages this website has that the site at the root does not, so a
 * shared journey link (routerest.app/share?j=...) or a bookmarked trip in
 * progress (routerest.app/navigate) still works. The query string is
 * carried over. Worked out rather than listed, so a page added to
 * LIVE_PAGES is covered without touching this.
 *
 * Temporary (307), never permanent: browsers remember a permanent
 * redirect, which would keep sending people away after ROOT_SITE changes.
 */
function rootSiteRedirects() {
  if (!rootArchive) {
    return [];
  }
  const missing = LIVE_PAGES.filter(
    (page) => !ARCHIVE_PAGES[rootArchive].includes(page),
  );
  if (missing.length === 0) {
    return [];
  }
  return [
    {
      source: `/:page(${missing.join("|")})`,
      destination: `${LIVE_PREFIX}/:page`,
      permanent: false,
    },
  ];
}

/**
 * Headers sent with every page, after the Iteration 2 security testing
 * found none of them present.
 *
 * There is deliberately no content security policy yet: the map, the
 * camera runtime and the QR image all load from different places, and a
 * policy written without testing each of them would break the product
 * rather than protect it. It is recorded as the next step instead.
 */
const SECURITY_HEADERS = [
  // Always use the secure address, even if someone types http.
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
  // Do not guess at file types, which is how a text file becomes a script.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Refuse to be displayed inside a frame on another site.
  { key: "X-Frame-Options", value: "DENY" },
  // Do not leak the full address of our pages to other sites.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // The camera and location are used by this site itself and nothing else.
  // Microphone is allowed for the Iteration 3 voice companion.
  {
    key: "Permissions-Policy",
    value: "camera=(self), geolocation=(self), microphone=(self)",
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  async redirects() {
    return rootSiteRedirects();
  },
  async rewrites() {
    return {
      // Before this site's own pages, so these paths are always served as
      // described above.
      beforeFiles: [
        ...rootSiteRewrites(),
        { source: LIVE_PREFIX, destination: "/" },
        { source: `${LIVE_PREFIX}/:path*`, destination: "/:path*" },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;
