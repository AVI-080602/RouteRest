import type { Metadata } from "next";
import { Link } from "@/utils/appNavigation";
import { ArrowRight } from "lucide-react";
import PageTopBar from "@/components/PageTopBar";

export const metadata: Metadata = {
  title: "Why It Matters",
};

/*
 * Colours shared with the home page (app/page.tsx), so the two pages
 * read as one: the same page tones in light and dark, the shared primary
 * button and the amber markers.
 */
const theme = {
  page: "bg-[#e8f0f8] text-[#142333] dark:bg-[#0b1520] dark:text-white",
  accent: "text-[#285781] dark:text-[#9fc2ff]",
  description: "text-[#34495e] dark:text-slate-200",
  primary:
    "bg-action text-on-action hover:bg-action-strong active:bg-action-strong",
  focus:
    "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#285781] dark:focus-visible:outline-white",
  card: "border border-[#c5d5e4] bg-white dark:border-white/10 dark:bg-white/[0.04]",
  note: "text-[#4a5d70] dark:text-slate-400",
  marker: "bg-[#d9771e] dark:bg-[#f5a524]",
  // The dashed "road" that leads to the button.
  road: "border-[#d9771e] dark:border-[#f5a524]",
};

/*
 * Expo visitors who have never driven a truck need a few numbers to see
 * why rest planning matters (mentor feedback, 18 Oct 2026). This was a
 * section of the home page until the 19 Oct feedback asked for a home
 * page without scrolling and this as its own page. Every figure was
 * checked against its original source on 18 Oct 2026; the sources line
 * under the cards names them. When a newer release comes out, update the
 * figure, its period and the sources line together.
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
 * Why it matters: the numbers behind RouteRest, opened from the button on
 * the home page, ending at "Plan a journey". The 15x figure on that button
 * is not repeated here.
 */
export default function WhyItMattersPage() {
  return (
    <main className={`min-h-svh ${theme.page}`}>
      <div className="mx-auto w-full max-w-7xl px-6 pb-12 pt-6 sm:px-10 sm:pb-16 sm:pt-8 lg:px-16">
        <PageTopBar fallback="/" />

        <div className="mx-auto mt-8 max-w-2xl text-center sm:mt-10">
          <p
            className={`text-xs font-extrabold uppercase tracking-[0.16em] ${theme.accent}`}
          >
            Why it matters
          </p>
          <h1 className="mt-3 text-[clamp(1.75rem,6vw,2.75rem)] font-extrabold leading-tight tracking-tight">
            The human cost of moving Australia.
          </h1>
          <p
            className={`mt-4 text-sm leading-relaxed sm:text-base ${theme.description}`}
          >
            So much of daily life depends on heavy vehicle drivers. Behind
            every delivery is a driver facing long hours, tight schedules and
            real safety risks.
          </p>
        </div>

        <div className="mt-10 grid gap-4 md:grid-cols-2">
          {/* The headline figure: a plain dark card in both themes, with
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

        {/* A short stretch of dashed centre line, like road markings,
            leading to the button. */}
        <div
          aria-hidden="true"
          className={`mx-auto mt-4 h-12 w-0 border-l-[3px] border-dashed opacity-80 sm:h-16 ${theme.road}`}
        />

        <div className="mx-auto mt-6 max-w-2xl text-center">
          <p className="text-lg font-extrabold leading-snug sm:text-xl">
            These aren’t just numbers. Behind them are real people, real
            families and lives that matter.
          </p>
          <p
            className={`mt-3 text-sm leading-relaxed sm:text-base ${theme.description}`}
          >
            RouteRest helps drivers plan rest before fatigue becomes a risk,
            and helps transport businesses run safer, more reliable journeys.
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

        {/* Plain text, not links: the page should not send visitors away
            from the app. */}
        <p
          className={`mx-auto mt-12 max-w-3xl text-center text-xs leading-relaxed ${theme.note}`}
        >
          Sources: National Road Safety Data Hub, Quarterly heavy vehicle road
          deaths, June 2026 (213 of 1,330 road deaths). BITRE, Australian
          Infrastructure and Transport Statistics Yearbook 2025, Table 1.1c.
          National Heavy Vehicle Regulator media releases, 8 October 2025 and
          20 November 2023. Safe Work Australia, Truck drivers WHS profile,
          November 2025.
        </p>
      </div>
    </main>
  );
}
