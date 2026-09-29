import { Link } from "@/utils/appNavigation";
import { AudioLines, Video } from "lucide-react";
import { OUTLINE_BUTTON_CLASS, PRIMARY_BUTTON_CLASS } from "@/utils/ui";

/**
 * Landing page (Iteration 3 design).
 *
 * The Iteration 2 landing page explained the product with three feature
 * cards, a four step walkthrough and a trust panel: around 250 words
 * before the driver reached anything they could act on. The Industry
 * Mentor's verdict on that build was that RouteRest shows too much text
 * and asks for too much tapping, and this page was the clearest example
 * of it.
 *
 * This version puts the two things a driver can actually do inside the
 * first screen, then says what the app is for in short blocks. The
 * wording is deliberately plain, because the reader is usually tired and
 * often standing next to a running truck.
 *
 * Server component on purpose: no state, no client JavaScript needed, so
 * it is the fastest page in the app to load.
 */

/**
 * The two features that separate RouteRest from an ordinary route
 * planner. Neither card is a link, and that is deliberate: camera
 * monitoring is offered inside the State Check when a journey starts,
 * and Rory is the voice companion being built this iteration. A card
 * that looks tappable but is not was exactly the kind of thing the
 * mentor objected to.
 */
const SUPPORT = [
  {
    icon: Video,
    title: "Camera monitoring",
    body: "Spot fatigue early. Always optional.",
    note: null,
    /* Light card: ink on brand-tint is 16.3:1, muted on brand-tint 6.5:1. */
    className: "bg-brand-tint",
    titleClass: "text-ink",
    bodyClass: "text-muted",
    iconClass: "text-brand-strong",
  },
  {
    icon: AudioLines,
    title: "Meet Rory",
    body: "Your hands-free driving companion.",
    /* Rory is this iteration's work and does not answer yet. Saying so on
       the card is the honest version of the mockup, which reads as though
       a driver could speak to the app today. */
    note: "Coming soon",
    /* Filled card: white on brand is 5.0:1, brand-tint on brand 4.8:1. */
    className: "bg-brand",
    titleClass: "text-white",
    bodyClass: "text-brand-tint",
    iconClass: "text-white",
  },
] as const;

/** What a driver gets out of the app, in the order they meet it. */
const STEPS = [
  "Plan routes & rest stops",
  "Get driving safety alerts",
  "View your score & AI tips",
] as const;

export default function Home() {
  return (
    <div className="mx-auto max-w-xl px-4 pb-10">
      <header className="py-5">
        <span className="text-xl font-extrabold tracking-tight text-brand">
          RouteRest
        </span>
      </header>

      <main className="flex flex-col gap-10">
        {/* Hero: who it is for, what it does, and the two ways in */}
        <section>
          <p className="rounded-lg bg-brand-tint px-3 py-2 text-xs font-bold uppercase tracking-wide text-brand-strong">
            For Australian truck drivers
          </p>
          <h1 className="mt-5 text-4xl font-extrabold leading-tight tracking-tight text-ink">
            Safer long drives.
            <br />
            Planned around rest.
          </h1>
          <p className="mt-4 text-base text-muted">
            Rest planning, fatigue monitoring and hands-free AI for safer
            journeys.
          </p>
          <div className="mt-6 flex flex-col gap-3">
            <Link href="/newjourney" className={PRIMARY_BUTTON_CLASS}>
              Plan my journey
            </Link>
            {/* US 1.4: a driver taking over a trip arrives here with no
                journey of their own, so scanning is offered next to
                planning rather than hidden inside an existing plan. */}
            <Link href="/share?mode=scan" className={OUTLINE_BUTTON_CLASS}>
              Scan a shared journey
            </Link>
          </div>
        </section>

        {/* The two features a route planner does not have */}
        <section aria-labelledby="support-heading">
          <h2 id="support-heading" className="text-lg font-bold text-ink">
            Support for every kilometre
          </h2>
          <div className="mt-3 grid grid-cols-2 gap-3">
            {SUPPORT.map(
              ({
                icon: Icon,
                title,
                body,
                note,
                className,
                titleClass,
                bodyClass,
                iconClass,
              }) => (
                <article
                  key={title}
                  className={`flex flex-col rounded-xl p-4 ${className}`}
                >
                  <Icon className={`h-7 w-7 ${iconClass}`} aria-hidden />
                  <h3 className={`mt-6 text-base font-bold ${titleClass}`}>
                    {title}
                  </h3>
                  <p className={`mt-2 text-sm ${bodyClass}`}>{body}</p>
                  {note ? (
                    <p className={`mt-3 text-sm font-bold ${titleClass}`}>
                      {note}
                    </p>
                  ) : null}
                </article>
              ),
            )}
          </div>
        </section>

        {/* What the app does, short enough to read at a glance */}
        <section aria-labelledby="steps-heading">
          <h2 id="steps-heading" className="text-lg font-bold text-ink">
            How RouteRest helps
          </h2>
          <ol className="mt-3 flex flex-col gap-2">
            {STEPS.map((step, index) => (
              <li
                key={step}
                className="flex items-center gap-4 rounded-lg bg-surface-alt px-4 py-3"
              >
                <span className="text-sm font-bold text-brand">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="text-sm font-semibold text-ink">{step}</span>
              </li>
            ))}
          </ol>
        </section>

        {/* The question drivers ask first: where does my data go */}
        <p className="rounded-lg bg-surface-alt px-4 py-3 text-xs text-muted">
          No account needed. Your journey stays on your device.
        </p>
      </main>
    </div>
  );
}
