/**
 * Light or dark, for the whole app.
 *
 * One switch (components/ThemeToggle.tsx) sets `data-theme` on <html>,
 * which app/globals.css reads to swap every colour token at once, and
 * remembers the choice on this phone. app/layout.tsx applies the saved
 * choice in a tiny script before the page is drawn, so a driver in dark
 * mode never sees a white flash between pages.
 *
 * Before this, each redesigned page had its own dark switch that reset
 * whenever the driver moved to another page (PR #36 review, 12 Oct 2026).
 */

export type Theme = "light" | "dark";

/** Where the choice is kept on the phone. Not personal data. */
export const THEME_STORAGE_KEY = "routerestTheme";

const listeners = new Set<() => void>();

/** The theme currently applied to the page. */
export function getTheme(): Theme {
  if (typeof document === "undefined") {
    return "light";
  }
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

/** The server always renders light; the saved theme is applied after. */
export function getServerTheme(): Theme {
  return "light";
}

/** Applies a theme to the whole app and remembers it on this phone. */
export function setTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage blocked: the theme still applies until the page is closed.
  }
  listeners.forEach((listener) => listener());
}

/** For useSyncExternalStore: re-render when the theme changes. */
export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The script app/layout.tsx puts in <head>. It runs before the first
 * paint and before React, so it is plain ES5 in a string.
 */
export const APPLY_SAVED_THEME_SCRIPT = `try{if(localStorage.getItem("${THEME_STORAGE_KEY}")==="dark"){document.documentElement.dataset.theme="dark"}}catch(e){}`;
