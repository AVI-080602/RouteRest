"use client";

import { useState } from "react";
import { Link } from "@/utils/appNavigation";
import {
  ArrowRight,
  AudioLines,
  Moon,
  ScanLine,
  Sun,
} from "lucide-react";

export default function Home() {
  // Start in light mode whenever this page mounts.
  const [isDark, setIsDark] = useState(false);

  // Apply the selected theme only to the homepage.
  const theme = isDark
    ? {
        page: "bg-[#080f18] text-white",
        logoAccent: "text-[#9fc2ff]",
        label: "text-[#9fc2ff]",
        description: "text-slate-200",
        companion: "text-[#b9d2ff]",
        toggle:
          "border-white/40 bg-[#101924]/90 text-white hover:bg-[#24344b]",
        primary:
          "bg-[#4d88ff] text-[#071426] hover:bg-[#77a5ff] active:bg-[#92b7ff]",
        secondary:
          "border-white/60 bg-[#101924]/90 text-white hover:bg-[#24344b]",
        footer: "text-slate-200",
        footerPanel: "border-white/15 bg-[#080f18]/85",
        focus:
          "focus-visible:outline-white",
      }
    : {
        page: "bg-[#dce9f5] text-[#142333]",
        logoAccent: "text-[#285781]",
        label: "text-[#285781]",
        description: "text-[#34495e]",
        companion: "text-[#285781]",
        toggle:
          "border-[#63778a] bg-white/85 text-[#142333] hover:bg-white",
        primary:
          "bg-[#111820] text-white hover:bg-[#293747] active:bg-[#35485d]",
        secondary:
          "border-[#63778a] bg-white text-[#142333] hover:bg-[#edf4fa]",
        footer: "text-[#34495e]",
        footerPanel: "border-white/70 bg-white/90",
        focus:
          "focus-visible:outline-[#285781]",
      };

  const focusClass =
    `focus-visible:outline-2 focus-visible:outline-offset-4 ${theme.focus}`;

  return (
    <main
      className={`relative isolate flex min-h-svh flex-col overflow-hidden ${theme.page}`}
      style={{ colorScheme: isDark ? "dark" : "light" }}
    >
      {/* Display the same background photo in both themes. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 -z-20 h-[65%] bg-cover bg-[62%_center] bg-no-repeat md:inset-0 md:h-full md:bg-center"
        style={{
          backgroundImage: "url('/images/home-truck.png')",
        }}
      />

      {/* Use theme-specific gradients to keep the text readable. */}
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute inset-0 -z-10 ${
          isDark
            ? "bg-[linear-gradient(180deg,#080f18_0%,#111e32_30%,rgba(15,27,45,0.92)_45%,rgba(8,15,24,0.15)_67%,rgba(8,15,24,0.90)_100%)] md:bg-[linear-gradient(90deg,rgba(8,15,24,0.98)_0%,rgba(8,15,24,0.92)_45%,rgba(8,15,24,0.25)_100%)]"
            : "bg-[linear-gradient(180deg,#c8dff3_0%,#e4edf5_30%,rgba(248,229,219,0.96)_45%,rgba(248,229,219,0.15)_67%,rgba(220,233,245,0.75)_100%)] md:bg-[linear-gradient(90deg,rgba(220,233,245,0.98)_0%,rgba(240,235,231,0.94)_45%,rgba(240,235,231,0.10)_100%)]"
        }`}
      />

      <div className="mx-auto flex min-h-svh w-full max-w-7xl flex-1 flex-col px-6 sm:px-10 lg:px-16">
        <header className="flex items-center justify-between gap-4 py-6 sm:py-8">
          {/* Keep the brand link available in both themes. */}
          <Link
            href="/"
            aria-label="RouteRest home"
            className={`inline-flex rounded-sm text-xl font-extrabold tracking-tight ${focusClass}`}
          >
            Route
            <span className={theme.logoAccent}>Rest</span>
          </Link>

          {/* Toggle the homepage theme without changing other pages. */}
          <button
            type="button"
            onClick={() => setIsDark((current) => !current)}
            aria-label="Dark mode"
            aria-pressed={isDark}
            className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition-colors ${theme.toggle} ${focusClass}`}
          >
            {isDark ? (
              <Sun aria-hidden="true" className="h-4 w-4" />
            ) : (
              <Moon aria-hidden="true" className="h-4 w-4" />
            )}
            {isDark ? "Light mode" : "Dark mode"}
          </button>
        </header>

        {/* Introduce the app using a short headline and description. */}
        <section
          aria-labelledby="home-heading"
          className="max-w-xl pt-6 sm:pt-10 md:pt-14"
        >
          <p
            className={`text-[11px] font-extrabold uppercase tracking-[0.16em] sm:text-xs ${theme.label}`}
          >
            For Australian truck drivers
          </p>

          <h1
            id="home-heading"
            className={`mt-4 text-[clamp(2.25rem,9vw,3.5rem)] font-extrabold leading-[1.08] tracking-tight md:text-6xl lg:text-7xl ${
              isDark ? "uppercase" : ""
            }`}
          >
            Safer long
            <br />
            drives.
            <br />
            Planned
            <br />
            around rest.
          </h1>

          <p
            className={`mt-5 max-w-sm text-sm leading-relaxed sm:text-base ${theme.description}`}
          >
            Plan rest breaks, find suitable stops, and choose optional
            fatigue monitoring for your journey.
          </p>

          <div
            className={`mt-4 flex max-w-sm items-start gap-2.5 text-xs font-semibold leading-relaxed sm:text-sm ${theme.companion}`}
          >
            <AudioLines
              aria-hidden="true"
              className="mt-0.5 h-4 w-4 shrink-0"
            />
            <p>
              Your voice companion, Rory, helps while you navigate.
            </p>
          </div>
        </section>

        {/* Leave room for the photo above the journey actions. */}
        <div
          aria-hidden="true"
          className="min-h-36 flex-1 md:min-h-20"
        />

        {/* Preserve the existing journey destinations. */}
        <nav
          aria-label="Journey actions"
          className="w-full max-w-md pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-8 sm:pb-8"
        >
          <div className="flex flex-col gap-3">
            <Link
              href="/newjourney"
              className={`inline-flex min-h-14 w-full items-center justify-center gap-3 rounded-xl px-5 py-3 text-sm font-extrabold shadow-lg transition-colors ${theme.primary} ${focusClass}`}
            >
              Plan a journey
              <ArrowRight
                aria-hidden="true"
                className="h-5 w-5"
              />
            </Link>

            <Link
              href="/share?mode=scan"
              className={`inline-flex min-h-14 w-full items-center justify-center gap-3 rounded-xl border px-5 py-3 text-sm font-bold transition-colors ${theme.secondary} ${focusClass}`}
            >
              <ScanLine
                aria-hidden="true"
                className="h-5 w-5"
              />
              Scan a shared journey
            </Link>
          </div>

          {/* Keep supporting text readable over the photo. */}
          <div
            className={`mt-4 rounded-xl border px-3 pt-3 text-center ${theme.footerPanel}`}
          >
            <p
              className={`text-xs leading-relaxed ${theme.footer}`}
            >
              No account needed. Your journey stays on your device.
            </p>

            <Link
              href="/performance/demo"
              className={`mt-1 inline-flex min-h-11 items-center rounded-sm text-xs font-semibold underline underline-offset-4 ${theme.footer} ${focusClass}`}
            >
              Rating demo
            </Link>
          </div>
        </nav>
      </div>
    </main>
  );
}