"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import {
  getServerTheme,
  getTheme,
  setTheme,
  subscribeTheme,
} from "@/utils/theme";

/**
 * The one dark mode switch, the same on every page (utils/theme.ts).
 * A 44 px square icon button; its name says what it does, and
 * aria-pressed says whether dark mode is on.
 */
export default function ThemeToggle({
  className = "",
}: {
  className?: string;
}) {
  const theme = useSyncExternalStore(subscribeTheme, getTheme, getServerTheme);
  const isDark = theme === "dark";

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      aria-label="Dark mode"
      aria-pressed={isDark}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
      className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line bg-surface-alt text-ink transition hover:border-line-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-soft ${className}`}
    >
      {isDark ? (
        <Sun className="h-5 w-5" aria-hidden />
      ) : (
        <Moon className="h-5 w-5" aria-hidden />
      )}
    </button>
  );
}
