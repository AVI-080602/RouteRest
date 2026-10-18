import { Link } from "@/utils/appNavigation";
import { ArrowDown, ArrowRight, AudioLines } from "lucide-react";
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
  focus:
    "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#285781] dark:focus-visible:outline-white",
  // The "Why it matters" section below the photo.
  section: "bg-[#e8f0f8] dark:bg-[#0b1520]",
  card: "border border-[#c5d5e4] bg-white dark:border-white/10 dark:bg-white/[0.04]",
  note: "text-[#4a5d70] dark:text-slate-400",
  marker: "bg-[#d9771e] dark:bg-[#f5a524]",
  // The dashed "road" that leads down the page to the button.
  road: "border-[#d9771e] dark:border-[#f5a524]",
};

/*
 * Why it matters (mentor feedback, 18 Oct 2026): expo visitors who have
 * never driven a truck need a few numbers to see why rest planning
 * matters. Every figure was checked against its original source on
 * 18 Oct 2026; the sources line under the cards names them. When a newer
 * release comes out, update the figure, its period and the sources line
 * together.
 */
const SUPPORTING_STATS = [
  {
    value: "253 billion",
    label: "tonne-kilometres of freight moved by road",
    note: "2024-25. From the food we eat to the things we buy.",
  },
  {
    value: "5,257",
    label: "fatigue offences recorded in the heavy vehicle industry",
    note: "2024-25. Almost a third of all offences recorded that year.",
  },
  {
    value: "Top 3",
    label: "Fatigue is one of the three biggest killers on our roads",
    note: "National Heavy Vehicle Regulator.",
  },
];

/**
 * A short stretch of dashed centre line, like the markings on a road.
 * The page reads as a road from the top down to the one button: what
 * RouteRest is, why it matters, then "Plan a journey".
 */
function RoadLine({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`mx-auto w-0 border-l-[3px] border-dashed opacity-80 ${theme.road} ${className}`}
    />
  );
}

/**
 * Home, laid out as a road down to one destination (mentor feedback,
 * 18 Oct 2026): what RouteRest is, the "15 times" card that leads into the
 * numbers behind it, then the only button, "Plan a journey", at the end.
 * No account and nothing stored here. Scanning a shared journey and the
 * rating demo stay reachable from the New Journey page and the journey
 * feedback card, so the home page only points where a driver should go.
 */
export default function Home() {
  return (
    <main className={theme.page}>
      <div className="relative isolate flex min-h-svh flex-col overflow-hidden">
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
          <header className="flex items-center justify-between gap-4 py-6 sm:py-8">
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

          {/* Introduce the app using a short headline and description. */}
          <section
            aria-labelledby="home-heading"
            className="max-w-xl pt-6 sm:pt-10 md:pt-14"
          >
            <p
              className={`text-xs font-extrabold uppercase tracking-[0.16em] ${theme.accent}`}
            >
              For Australian truck drivers
            </p>

            <h1
              id="home-heading"
              className="mt-4 text-[clamp(2.25rem,9vw,3.5rem)] font-extrabold leading-[1.08] tracking-tight md:text-6xl lg:text-7xl dark:uppercase"
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

          {/* Leave room for the photo above the card. */}
          <div aria-hidden="true" className="min-h-36 flex-1 md:min-h-12" />

          {/* The first stop on the road: one number that makes people
              want to know more, and a jump down to the rest. It is not
              repeated below. Safe Work Australia, Truck drivers WHS
              profile (Nov 2025): a fatality rate of 22.6 per 100,000
              workers over ten years, 15 times the 1.5 for all
              occupations. It stays dark in both themes so it reads well
              over the photo. */}
          <a
            href="#why-it-matters"
            aria-label="Truck drivers are 15 times more likely to die at work than the average Australian worker. Why it matters"
            className={`mx-auto flex w-full max-w-xs flex-col items-center rounded-2xl border border-white/15 bg-[#080f18]/85 px-6 py-5 text-center text-white shadow-2xl backdrop-blur-sm transition-colors hover:bg-[#080f18]/95 ${theme.focus}`}
          >
            <span className="text-5xl font-extrabold leading-none tracking-tight">
              15&times;
            </span>
            <span className="mt-2 text-sm font-semibold leading-snug text-slate-200">
              A truck driver&rsquo;s risk of dying at work, compared with the
              average Australian worker.
            </span>
            <span className="mt-4 inline-flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-[0.14em] text-[#f5a524]">
              Why it matters
              <ArrowDown aria-hidden="true" className="h-4 w-4" />
            </span>
          </a>

          {/* The road carries on down into the next section. */}
          <RoadLine className="mt-3 h-10 sm:h-14" />
        </div>
      </div>

      {/* Why it matters: a few verified numbers for people who have never
          driven a truck, then the only button on the page. */}
      <section
        id="why-it-matters"
        aria-labelledby="why-heading"
        className={theme.section}
      >
        <div className="mx-auto w-full max-w-7xl px-6 pb-12 sm:px-10 sm:pb-16 lg:px-16">
          <RoadLine className="h-10 sm:h-14" />

          <div className="mx-auto mt-6 max-w-2xl text-center">
            <p
              className={`text-xs font-extrabold uppercase tracking-[0.16em] ${theme.accent}`}
            >
              Why it matters
            </p>
            <h2
              id="why-heading"
              className="mt-3 text-[clamp(1.75rem,6vw,2.75rem)] font-extrabold leading-tight tracking-tight"
            >
              The human cost of moving Australia.
            </h2>
            <p
              className={`mt-4 text-sm leading-relaxed sm:text-base ${theme.description}`}
            >
              So much of daily life depends on heavy vehicle drivers. Behind
              every delivery is a driver facing long hours, tight schedules
              and real safety risks.
            </p>
          </div>

          <div className="mt-10 grid gap-4 md:grid-cols-2">
            {/* The headline figure: a plain dark card in both themes (no
                photo, so it does not repeat the top of the page), with
                the same amber marker as the other cards. */}
            <article className="relative flex min-h-72 flex-col justify-end overflow-hidden rounded-2xl border border-white/10 bg-[#0f1a29] p-6 text-white sm:p-8 md:row-span-3">
              <span
                aria-hidden="true"
                className="absolute bottom-8 left-0 top-8 w-1.5 rounded-r bg-[#f5a524]"
              />
              <p className="text-[clamp(5rem,20vw,9rem)] font-extrabold leading-none tracking-tighter">
                213
              </p>
              <p className="mt-2 text-2xl font-extrabold uppercase tracking-tight sm:text-3xl">
                Lives lost
              </p>
              <p className="mt-2 max-w-sm text-sm leading-relaxed text-slate-200 sm:text-base">
                in crashes involving heavy vehicles in the 12 months to June
                2026.
              </p>
              <p className="mt-3 text-sm font-semibold text-[#f5a524]">
                About 1 in 6 of all road deaths in Australia.
              </p>
            </article>

            {SUPPORTING_STATS.map((stat) => (
              <article
                key={stat.value}
                className={`relative overflow-hidden rounded-2xl py-5 pl-6 pr-5 ${theme.card}`}
              >
                <span
                  aria-hidden="true"
                  className={`absolute bottom-5 left-0 top-5 w-1 rounded-r ${theme.marker}`}
                />
                <p className="text-3xl font-extrabold tracking-tight sm:text-4xl">
                  {stat.value}
                </p>
                <p className="mt-1 text-sm font-bold leading-snug sm:text-base">
                  {stat.label}
                </p>
                <p className={`mt-1 text-xs leading-relaxed sm:text-sm ${theme.note}`}>
                  {stat.note}
                </p>
              </article>
            ))}
          </div>

          {/* The last stretch of road, ending at the only button. */}
          <RoadLine className="mt-4 h-12 sm:h-16" />

          <div className="mx-auto mt-6 max-w-2xl text-center">
            <p className="text-lg font-extrabold leading-snug sm:text-xl">
              These aren’t just numbers. Behind them are real people, real
              families and lives that matter.
            </p>
            <p
              className={`mt-3 text-sm leading-relaxed sm:text-base ${theme.description}`}
            >
              RouteRest helps drivers plan rest before fatigue becomes a risk,
              and helps transport businesses run safer, more reliable
              journeys.
            </p>
            <Link
              href="/newjourney"
              className={`mt-8 inline-flex min-h-14 w-full max-w-md items-center justify-center gap-3 rounded-xl px-5 py-3 text-base font-extrabold shadow-lg transition-colors ${theme.primary} ${theme.focus}`}
            >
              Plan a journey
              <ArrowRight aria-hidden="true" className="h-5 w-5" />
            </Link>
            <p className={`mt-3 text-xs leading-relaxed ${theme.note}`}>
              No account needed. Your journey stays on your device.
            </p>
          </div>

          {/* Plain text, not links: the page should not send visitors
              away from the app. */}
          <p
            className={`mx-auto mt-12 max-w-3xl text-center text-xs leading-relaxed ${theme.note}`}
          >
            Sources: National Road Safety Data Hub, Quarterly heavy vehicle
            road deaths, June 2026 (213 of 1,330 road deaths). BITRE,
            Australian Infrastructure and Transport Statistics Yearbook 2025,
            Table 1.1c. National Heavy Vehicle Regulator media releases, 8
            October 2025 and 20 November 2023. Safe Work Australia, Truck
            drivers WHS profile, November 2025.
          </p>
        </div>
      </section>
    </main>
  );
}
