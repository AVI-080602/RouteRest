import Link from "next/link";
import {
  AlarmClock,
  MapPinned,
  Route,
  ShieldCheck,
  Smartphone,
} from "lucide-react";
import Disclaimer from "@/components/Disclaimer";
import { PRIMARY_BUTTON_CLASS } from "@/utils/ui";

/**
 * Landing page. The first version was a heading and a button, which told
 * a first-time visitor nothing about what the product is for. This one
 * answers the three questions a driver (or an assessor) has before they
 * tap anything: what does it do, how does a journey go, and what happens
 * to my data.
 *
 * Server component on purpose: no state, no client JavaScript needed, so
 * it is the fastest page in the app to load.
 */

const FEATURES = [
  {
    icon: AlarmClock,
    title: "Know when to rest",
    body: "Enter your departure, destination and target arrival. RouteRest works out every break the NHVR rules require and tells you straight away if the schedule is too tight.",
  },
  {
    icon: MapPinned,
    title: "Know where to stop",
    body: "Each planned break is matched to a heavy-vehicle rest area on your route, with facilities and detour distance shown before you choose.",
  },
  {
    icon: Route,
    title: "Drive the plan",
    body: "Follow the truck-legal route on the map with your rest stops marked, and let the plan adjust when the journey changes.",
  },
] as const;

const STEPS = [
  {
    title: "Set up the journey",
    body: "Departure, stops, vehicle, fuel and the time you need to arrive.",
  },
  {
    title: "Review the plan",
    body: "See the route, the breaks you must take and the earliest arrival that respects them.",
  },
  {
    title: "Choose your stops",
    body: "Pick from suitable rest areas near each break, ranked by facilities and detour.",
  },
  {
    title: "Start driving",
    body: "Follow the route with your stops on the map and rest when the plan says so.",
  },
] as const;

export default function Home() {
  return (
    <div className="container mx-auto max-w-4xl px-4">
      <main className="flex flex-col gap-14 py-10 sm:py-16">
        {/* Hero */}
        <section className="flex flex-col items-center text-center">
          <span className="rounded-full bg-brand-tint px-3 py-1 text-xs font-bold uppercase tracking-wide text-brand-strong">
            For long-distance heavy vehicle drivers in Australia
          </span>
          <h1 className="mt-5 text-4xl font-extrabold tracking-tight text-ink sm:text-5xl">
            RouteRest
          </h1>
          <p className="mt-3 max-w-2xl text-lg text-muted">
            Know when to rest, where to stop, and when to adjust the plan.
            RouteRest turns the NHVR work and rest rules into a journey plan you
            can actually drive.
          </p>
          <div className="mt-8 w-full max-w-sm">
            <Link href="/newjourney" className={PRIMARY_BUTTON_CLASS}>
              Plan my journey
            </Link>
          </div>
          <p className="mt-3 text-xs text-muted">
            No account needed. Your journey stays on this device.
          </p>
        </section>

        {/* What it does */}
        <section aria-labelledby="features-heading">
          <h2 id="features-heading" className="sr-only">
            What RouteRest does
          </h2>
          <div className="grid gap-4 sm:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, body }) => (
              <article
                key={title}
                className="rounded-xl border border-line bg-surface-alt p-5"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand text-white">
                  <Icon className="h-5 w-5" aria-hidden />
                </div>
                <h3 className="mt-4 text-base font-bold text-ink">{title}</h3>
                <p className="mt-2 text-sm text-muted">{body}</p>
              </article>
            ))}
          </div>
        </section>

        {/* How a journey goes */}
        <section aria-labelledby="steps-heading">
          <h2
            id="steps-heading"
            className="text-center text-2xl font-bold text-ink"
          >
            How a journey goes
          </h2>
          <ol className="mt-6 grid gap-4 sm:grid-cols-2">
            {STEPS.map(({ title, body }, index) => (
              <li
                key={title}
                className="flex gap-4 rounded-xl border border-line p-4"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-tint text-sm font-bold text-brand-strong">
                  {index + 1}
                </span>
                <div>
                  <h3 className="font-semibold text-ink">{title}</h3>
                  <p className="mt-1 text-sm text-muted">{body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* Trust: rules and privacy, the two things drivers ask about */}
        <section
          aria-labelledby="trust-heading"
          className="rounded-xl bg-brand-tint p-6"
        >
          <h2 id="trust-heading" className="sr-only">
            Built on the rules, private by design
          </h2>
          <div className="grid gap-6 sm:grid-cols-2">
            <div className="flex gap-4">
              <ShieldCheck
                className="h-6 w-6 shrink-0 text-brand-strong"
                aria-hidden
              />
              <div>
                <h3 className="font-bold text-ink">
                  Built on the NHVR Standard Hours
                </h3>
                <p className="mt-1 text-sm text-muted">
                  Break timing follows the National Heavy Vehicle
                  Regulator&apos;s work and rest limits for solo and two-up
                  driving, with Western Australia&apos;s separate scheme handled
                  too.
                </p>
              </div>
            </div>
            <div className="flex gap-4">
              <Smartphone
                className="h-6 w-6 shrink-0 text-brand-strong"
                aria-hidden
              />
              <div>
                <h3 className="font-bold text-ink">Private by design</h3>
                <p className="mt-1 text-sm text-muted">
                  There are no accounts. Your journey, vehicle and rest plan are
                  stored only in your browser and never sent to a server.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Closing call to action */}
        <section className="flex flex-col items-center gap-3 text-center">
          <h2 className="text-xl font-bold text-ink">
            Ready for the next run?
          </h2>
          <div className="w-full max-w-sm">
            <Link href="/newjourney" className={PRIMARY_BUTTON_CLASS}>
              Plan my journey
            </Link>
          </div>
          <Disclaimer className="mt-2 max-w-xl" />
          <p className="text-xs text-muted">
            Rest area data from the National Freight Data Hub. Map data &copy;
            OpenStreetMap contributors.
          </p>
        </section>
      </main>
    </div>
  );
}
