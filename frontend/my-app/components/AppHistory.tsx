"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * Remembers which RouteRest pages this tab has visited, in order, so the
 * Back button (components/BackButton.tsx) knows whether going back stays
 * inside the app.
 *
 * Why not just history.back(): when a driver opens a page directly (a
 * shared link, a QR code, a new tab) the previous history entry is some
 * other website, and Back would leave RouteRest. The browser does not say
 * what the previous entry is, so the app keeps its own list: a page that
 * matches the one before the current page is a step back (the list
 * shrinks), anything else is a step forward (the list grows).
 *
 * Kept in sessionStorage: this tab only, gone when the tab closes, and
 * only page paths, nothing about the journey.
 */
export const APP_HISTORY_STORAGE_KEY = "routerestPageHistory";
const MAX_PAGES = 30;

export function readAppHistory(): string[] {
  try {
    const raw = sessionStorage.getItem(APP_HISTORY_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

export default function AppHistory() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname) {
      return;
    }
    const pages = readAppHistory();
    if (pages[pages.length - 1] === pathname) {
      return; // A reload of the same page.
    }
    if (pages[pages.length - 2] === pathname) {
      pages.pop(); // Back to the page before.
    } else {
      pages.push(pathname);
    }
    try {
      sessionStorage.setItem(
        APP_HISTORY_STORAGE_KEY,
        JSON.stringify(pages.slice(-MAX_PAGES)),
      );
    } catch {
      // Storage blocked: Back falls back to each page's usual previous page.
    }
  }, [pathname]);

  return null;
}
