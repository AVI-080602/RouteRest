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
 *
 * Dark is the default (12 Oct 2026): the app is used in a truck cab, often
 * at night, where a bright white screen is glaring. The server renders
 * <html data-theme="dark">, and only a driver who chose light mode on this
 * phone gets the light version.
 */

export type Theme = "light" | "dark";

/** Where the choice is kept on the phone. Not personal data. */
export const THEME_STORAGE_KEY = "routerestTheme";

/** What a driver sees before choosing: dark, for night driving. */
export const DEFAULT_THEME: Theme = "dark";

const listeners = new Set<() => void>();

/** The theme currently applied to the page. */
export function getTheme(): Theme {
  if (typeof document === "undefined") {
    return DEFAULT_THEME;
  }
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

/** The server always renders the default; a saved choice is applied after. */
export function getServerTheme(): Theme {
  return DEFAULT_THEME;
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
 * paint and before React, so it is plain ES5 in a string. The page
 * arrives dark; this switches it to light only if the driver chose light
 * on this phone. Anything else saved (or storage blocked) stays dark.
 */
export const APPLY_SAVED_THEME_SCRIPT = `try{if(localStorage.getItem("${THEME_STORAGE_KEY}")==="light"){document.documentElement.dataset.theme="light"}}catch(e){}`;
