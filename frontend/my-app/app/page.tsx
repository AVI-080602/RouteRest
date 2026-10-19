import { Link } from "@/utils/appNavigation";
import { ArrowRight, AudioLines } from "lucide-react";
import ThemeToggle from "@/components/ThemeToggle";

/*
 * The home page's own colours (PR #36 redesign): a photo background with
 * a gradient that keeps the text readable, in a light and a dark version.
 * `dark:` follows the app-wide switch (utils/theme.ts), so the choice
 * carries over to every other page. The main button uses the shared
 * primary (action) colours.
 */
const theme = {
  page: "bg-[#dce9f5] text-[#142333] dark:bg-[#080f18] dark:text-white",
  accent: "text-[#285781] dark:text-[#9fc2ff]",
  description: "text-[#34495e] dark:text-slate-200",
  companion: "text-[#285781] dark:text-[#b9d2ff]",
  primary:
    "bg-action text-on-action hover:bg-action-strong active:bg-action-strong",
  // The "Plan a journey" panel over the photo on a laptop.
  panel:
    "md:border md:border-white/70 md:bg-white/90 md:shadow-2xl md:backdrop-blur-sm dark:md:border-white/15 dark:md:bg-[#080f18]/85",
  note: "text-[#34495e] dark:text-slate-300",
  focus:
    "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#285781] dark:focus-visible:outline-white",
};

/**
 * Home: one screen with no scrolling (mentor feedback, 19 Oct 2026). On a
 * laptop the headline sits on the left, "Plan a journey" in the open space
 * at the top right, and the "Why it matters" button at the bottom right,
 * which opens its own page. On a phone the same three things stack:
 * headline, then the two buttons under the photo. No account and nothing
 * stored here.
 */
export default function Home() {
  return (
    <main
      className={`relative isolate flex min-h-svh flex-col overflow-hidden ${theme.page}`}
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
        className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(180deg,#c8dff3_0%,#e4edf5_30%,rgba(248,229,219,0.96)_45%,rgba(248,229,219,0.15)_67%,rgba(220,233,245,0.75)_100%)] md:bg-[linear-gradient(90deg,rgba(220,233,245,0.98)_0%,rgba(240,235,231,0.94)_45%,rgba(240,235,231,0.10)_100%)] dark:bg-[linear-gradient(180deg,#080f18_0%,#111e32_30%,rgba(15,27,45,0.92)_45%,rgba(8,15,24,0.15)_67%,rgba(8,15,24,0.90)_100%)] md:dark:bg-[linear-gradient(90deg,rgba(8,15,24,0.98)_0%,rgba(8,15,24,0.92)_45%,rgba(8,15,24,0.25)_100%)]"
      />

      <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col px-6 sm:px-10 lg:px-16">
        <header className="flex items-center justify-between gap-4 py-6 sm:py-8 [@media(max-height:760px)]:py-4">
          {/* Keep the brand link available in both themes. */}
          <Link
            href="/"
            aria-label="RouteRest home"
            className={`inline-flex rounded-sm text-xl font-extrabold tracking-tight ${theme.focus}`}
          >
            Route
            <span className={theme.accent}>Rest</span>
          </Link>

          {/* The one dark mode switch for the whole app. */}
          <ThemeToggle />
        </header>

        {/* Phone: one column. Laptop: the headline on the left, and on
            the right "Plan a journey" at the top and "Why it matters" at
            the bottom, so everything fits on one screen. */}
        <div className="flex flex-1 flex-col pb-[max(1.5rem,env(safe-area-inset-bottom))] md:grid md:grid-cols-[minmax(0,1fr)_20rem] md:grid-rows-[auto_minmax(0,1fr)_auto] md:gap-x-10 md:pb-10 lg:grid-cols-[minmax(0,1fr)_22rem]">
          {/* Introduce the app using a short headline and description. */}
          <section
            aria-labelledby="home-heading"
            className="max-w-xl pt-6 sm:pt-10 md:row-span-3 md:pt-[min(3.5rem,5svh)] [@media(max-height:760px)]:pt-2"
          >
            <p
              className={`text-xs font-extrabold uppercase tracking-[0.16em] ${theme.accent}`}
            >
              For Australian truck drivers
            </p>

            {/* On a laptop the headline also scales with the window
                height, so a short screen still fits without scrolling. */}
            <h1
              id="home-heading"
              className="mt-4 text-[clamp(2.25rem,9vw,3.5rem)] font-extrabold leading-[1.08] tracking-tight md:text-[min(3.75rem,8.5svh)] lg:text-[min(4.5rem,9svh)] dark:uppercase"
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
              Plan rest breaks, find suitable stops, and choose optional fatigue
              monitoring for your journey.
            </p>

            <div
              className={`mt-4 flex max-w-sm items-start gap-2.5 text-xs font-semibold leading-relaxed sm:text-sm ${theme.companion}`}
            >
              <AudioLines
                aria-hidden="true"
                className="mt-0.5 h-4 w-4 shrink-0"
              />
              <p>Your voice companion, Rory, helps while you navigate.</p>
            </div>
          </section>

          {/* Phone only: leave room for the photo above the buttons, less
              on a short screen so the page still fits without scrolling. */}
          <div
            aria-hidden="true"
            className="min-h-36 flex-1 md:hidden [@media(max-height:760px)]:min-h-8"
          />

          {/* The main action. On a laptop it is a panel in the open space
              at the top right; on a phone, the first button under the
              photo. */}
          <nav
            aria-label="Journey actions"
            className={`w-full max-w-md md:col-start-2 md:row-start-1 md:mt-[min(3.5rem,5svh)] md:max-w-none md:rounded-2xl md:p-6 ${theme.panel}`}
          >
            <p
              className={`hidden text-xs font-extrabold uppercase tracking-[0.16em] md:block ${theme.accent}`}
            >
              Start here
            </p>
            <p className="mb-4 hidden text-xl font-extrabold leading-snug md:block">
              Plan your next journey, with rest breaks built in.
            </p>
            <Link
              href="/newjourney"
              className={`inline-flex min-h-14 w-full items-center justify-center gap-3 rounded-xl px-5 py-3 text-base font-extrabold shadow-lg transition-colors ${theme.primary} ${theme.focus}`}
            >
              Plan a journey
              <ArrowRight aria-hidden="true" className="h-5 w-5" />
            </Link>
            <p
              className={`mt-3 text-center text-xs leading-relaxed ${theme.note}`}
            >
              No account needed. Your journey stays on your device.
            </p>
          </nav>

          {/* Why it matters: a button that opens its own page with the
              numbers. The figure on it is not repeated there. Safe Work
              Australia, Truck drivers WHS profile (Nov 2025): a fatality
              rate of 22.6 per 100,000 workers over ten years, 15 times
              the 1.5 for all occupations. It stays dark in both themes so
              it reads well over the photo. */}
          <Link
            href="/why-it-matters"
            aria-label="Why it matters: a truck driver is 15 times more likely to die at work than the average Australian worker"
            className={`mt-3 flex w-full max-w-md items-center gap-4 rounded-2xl border border-white/15 bg-[#080f18]/85 px-5 py-4 text-left text-white shadow-2xl backdrop-blur-sm transition-colors hover:bg-[#080f18]/95 md:col-start-2 md:row-start-3 md:mt-0 md:max-w-none ${theme.focus}`}
          >
            <span className="text-4xl font-extrabold leading-none tracking-tight">
              15&times;
            </span>
            <span className="flex-1">
              <span className="block text-sm font-semibold leading-snug text-slate-200">
                A truck driver&rsquo;s risk of dying at work, compared with
                the average Australian worker.
              </span>
              <span className="mt-2 inline-flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-[0.14em] text-[#f5a524]">
                Why it matters
                <ArrowRight aria-hidden="true" className="h-4 w-4" />
              </span>
            </span>
          </Link>
        </div>
      </div>
    </main>
  );
}
