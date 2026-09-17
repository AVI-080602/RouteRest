"use client";

/**
 * Link and useRouter for every in-app page change, so the address the
 * driver opened the site under is kept while they move around it.
 *
 * routerest.app/iteration2/... shows this same site through the rewrite
 * in next.config.ts. A plain Next.js link to "/newjourney" would drop the
 * /iteration2 part on the first click, so pages import Link and useRouter
 * from here instead of from "next/link" and "next/navigation" (the ESLint
 * config enforces this). On plain routerest.app nothing is added.
 *
 * Paths are still written as "/newjourney"; only the prefix is added here.
 */

import NextLink from "next/link";
import { useRouter as useNextRouter } from "next/navigation";
import { type ComponentProps, useMemo, useSyncExternalStore } from "react";

/** Must match the rewrite source in next.config.ts. */
export const ITERATION2_PATH_PREFIX = "/iteration2";

/**
 * The prefix a browser pathname was opened under: "/iteration2" for
 * "/iteration2" and anything below it, otherwise "".
 */
export function pathPrefixFor(pathname: string): string {
  return pathname === ITERATION2_PATH_PREFIX ||
    pathname.startsWith(`${ITERATION2_PATH_PREFIX}/`)
    ? ITERATION2_PATH_PREFIX
    : "";
}

/**
 * Adds a prefix to an in-app path such as "/share?mode=scan". Anything
 * that is not an in-app path (a full URL, "#section") is left alone, as
 * is a path that already carries the prefix.
 */
export function withPathPrefix(path: string, prefix: string): string {
  if (
    !prefix ||
    !path.startsWith("/") ||
    path.startsWith("//") ||
    pathPrefixFor(path.split(/[?#]/)[0]) === prefix
  ) {
    return path;
  }
  // The home page becomes "/iteration2", not "/iteration2/".
  return path === "/" ? prefix : `${prefix}${path}`;
}

// Back and forward change the address without remounting every link, so
// the prefix is read again when they happen.
function subscribeToHistory(onChange: () => void) {
  window.addEventListener("popstate", onChange);
  return () => window.removeEventListener("popstate", onChange);
}

const getClientPrefix = () => pathPrefixFor(window.location.pathname);

// Pages are prerendered without knowing which address will be used, so
// the server render and hydration use no prefix and React re-renders with
// the real one straight after. Reading window during render instead
// would leave a mismatched href in the page.
const getServerPrefix = () => "";

/** The prefix of the current address, "" until the page has hydrated. */
export function usePathPrefix(): string {
  return useSyncExternalStore(
    subscribeToHistory,
    getClientPrefix,
    getServerPrefix,
  );
}

type LinkProps = Omit<ComponentProps<typeof NextLink>, "href"> & {
  /** An in-app path such as "/newjourney". */
  href: string;
};

/** next/link, with the current address prefix added to href. */
export function Link({ href, ...props }: LinkProps) {
  const prefix = usePathPrefix();
  return <NextLink href={withPathPrefix(href, prefix)} {...props} />;
}

type NextRouter = ReturnType<typeof useNextRouter>;

/**
 * next/navigation's useRouter, with the current address prefix added to
 * push, replace and prefetch. The prefix is read when the call happens,
 * which is always in the browser, so a push after an await still uses the
 * address the driver is on.
 */
export function useRouter(): NextRouter {
  const router = useNextRouter();
  return useMemo(() => {
    const prefixed = (href: string) =>
      withPathPrefix(href, pathPrefixFor(window.location.pathname));
    return {
      ...router,
      push: (href, options) => router.push(prefixed(href), options),
      replace: (href, options) => router.replace(prefixed(href), options),
      prefetch: (href, options) => router.prefetch(prefixed(href), options),
    };
  }, [router]);
}
