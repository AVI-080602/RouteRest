"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { Navigation, Route, ShieldCheck, UserRound } from "lucide-react";
import RouteMap from "@/components/RouteMap";
import { JourneyDetails, RestBreak } from "@/types/journeyDetails";
import { PlannedSafeStop, RouteBreaksData } from "@/types/routeBreaks";

const LOCAL_STORAGE_KEY = "currentJourneyDetails";
const REST_PLAN_STORAGE_KEY = "currentRestPlan";

function subscribeToJourneyStorage(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  return () => window.removeEventListener("storage", onStoreChange);
}

function getSavedJourneySnapshot() {
  return localStorage.getItem(LOCAL_STORAGE_KEY);
}

function getSavedRestPlanSnapshot() {
  return localStorage.getItem(REST_PLAN_STORAGE_KEY);
}

function getServerJourneySnapshot() {
  return null;
}

const fallbackRestBreaks: RestBreak[] = [
  {
    start: "2026-09-01T11:15:00",
    end: "2026-09-01T11:30:00",
    reason: "Short rest required under the NHVR 5.5-hour rule",
  },
  {
    start: "2026-09-01T13:40:00",
    end: "2026-09-01T14:10:00",
    reason: "Major rest required under the NHVR 24-hour rule",
  },
];

const mockRouteBreaksData: RouteBreaksData = {
  // Temporary route shape for the map preview. This will be replaced by
  // OpenRouteService geometry once real routing is connected.
  routeGeometry: [
    { lat: -37.8136, lng: 144.9631 },
    { lat: -36.758, lng: 144.28 },
    { lat: -35.2809, lng: 149.13 },
    { lat: -33.8688, lng: 151.2093 },
  ],
  destinations: [
    {
      label: "Canberra City, ACT 2601, Australia",
      coordinate: { lat: -35.2809, lng: 149.13 },
    },
    {
      label: "Sydney CBD, NSW 2000, Australia",
      coordinate: { lat: -33.8688, lng: 151.2093 },
    },
  ],
  restStops: [
    {
      id: "stop-1",
      name: "Goulburn Heavy Vehicle Rest Area",
      coordinate: { lat: -34.7516, lng: 149.7209 },
      distanceKm: 214,
      estimatedArrivalTime: "11:15 AM",
      facilities: ["Toilets", "Lighting", "Heavy vehicle parking"],
      restBreak: fallbackRestBreaks[0],
      isDriverSwitchLocation: false,
    },
    {
      id: "stop-2",
      name: "Pheasants Nest Service Centre",
      coordinate: { lat: -34.2558, lng: 150.6408 },
      distanceKm: 312,
      estimatedArrivalTime: "1:40 PM",
      facilities: ["Fuel", "Food", "Lighting", "Rest area"],
      restBreak: fallbackRestBreaks[1],
      isDriverSwitchLocation: true,
    },
  ],
  currentEta: "4:30 PM",
  currentActiveDriver: "Primary Driver",
};

function formatRestBreakTime(value: string) {
  return new Intl.DateTimeFormat("en-AU", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function buildPlannedStops(restPlan: RestBreak[]): PlannedSafeStop[] {
  const stopTemplates = mockRouteBreaksData.restStops;

  // This is the bridge between US1.3 and Route & Breaks: the backend tells
  // us when rest is required, while the future stop API will choose where.
  return restPlan.map((restBreak, index) => {
    const template = stopTemplates[index % stopTemplates.length];

    return {
      ...template,
      id: `${template.id}-${index}`,
      estimatedArrivalTime: formatRestBreakTime(restBreak.start),
      restBreak,
      isDriverSwitchLocation:
        restBreak.reason.toLowerCase().includes("major rest") &&
        template.isDriverSwitchLocation,
    };
  });
}

export default function RouteBreaksPage() {
  // useSyncExternalStore keeps the server render and the first browser
  // render aligned, then reads localStorage after hydration.
  const savedJourney = useSyncExternalStore(
    subscribeToJourneyStorage,
    getSavedJourneySnapshot,
    getServerJourneySnapshot,
  );
  const savedRestPlan = useSyncExternalStore(
    subscribeToJourneyStorage,
    getSavedRestPlanSnapshot,
    getServerJourneySnapshot,
  );

  // Parse the saved journey details from localStorage, if available.
  const journeyDetails: JourneyDetails | null = savedJourney
    ? JSON.parse(savedJourney)
    : null;
  const restPlan: RestBreak[] = savedRestPlan ? JSON.parse(savedRestPlan) : [];

  const plannedStops =
    restPlan.length > 0
      ? buildPlannedStops(restPlan)
      : mockRouteBreaksData.restStops;
  const driverSwitchStops = plannedStops.filter(
    (stop) => stop.isDriverSwitchLocation,
  );

  return (
    <main className="container mx-auto px-4">
      <div className="flex min-h-screen flex-col gap-4 py-4">
        <header className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-slate-400">Journey Plan</p>
            <h1 className="text-2xl font-bold">Route & Breaks</h1>
          </div>
          <Link
            href="/newjourney"
            className="rounded-xl border border-slate-700 px-3 py-2 text-sm font-semibold text-slate-300 transition active:border-yellow-500 active:text-yellow-500"
          >
            Edit
          </Link>
        </header>

        {/* Missing journey details message */}
        {!journeyDetails && (
          <section className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-5">
            <h2 className="text-lg font-bold">No journey found</h2>
            <p className="mt-2 text-sm text-slate-400">
              Create a journey first so the route and break plan can be shown.
            </p>
            <Link
              href="/newjourney"
              className="mt-4 inline-flex w-full items-center justify-center rounded-xl bg-yellow-500 px-4 py-3 font-semibold text-black transition active:bg-yellow-600"
            >
              Plan My Journey
            </Link>
          </section>
        )}

        {/* Render the route and break details only if journey details are available */}
        {journeyDetails && (
          <>
            <section className="grid grid-cols-2 gap-3">
              <SummaryTile
                icon={<Navigation className="h-5 w-5" />}
                label="Current ETA"
                value={mockRouteBreaksData.currentEta}
              />
              <SummaryTile
                icon={<UserRound className="h-5 w-5" />}
                label="Active Driver"
                value={mockRouteBreaksData.currentActiveDriver}
              />
              <SummaryTile
                icon={<Route className="h-5 w-5" />}
                label="Remaining Range"
                value={`${journeyDetails.fuelLevel} km`}
              />
              <SummaryTile
                icon={<ShieldCheck className="h-5 w-5" />}
                label="Safe Stops"
                value={`${plannedStops.length}`}
              />
            </section>

            <section className="rounded-xl bg-slate-800 px-3 py-3">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-bold">Planned Route</h2>
                  <p className="text-sm text-slate-400">
                    {journeyDetails.departureLocation}
                  </p>
                </div>
                <span className="rounded-full bg-yellow-500 px-3 py-1 text-xs font-bold text-black">
                  Live Map
                </span>
              </div>

              <RouteMap
                data={{ ...mockRouteBreaksData, restStops: plannedStops }}
              />
            </section>

            <section className="flex flex-col gap-2">
              <h2 className="text-lg font-bold">Destinations</h2>
              <ol className="flex flex-col gap-2">
                {journeyDetails.destination.map((destination, index) => (
                  <li
                    key={destination.id}
                    className="flex items-start gap-3 rounded-xl bg-slate-800 px-3 py-2 text-sm"
                  >
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-yellow-500 text-xs font-bold text-black">
                      {index + 1}
                    </span>
                    <span className="text-white">{destination.label}</span>
                  </li>
                ))}
              </ol>
            </section>

            <section className="flex flex-col gap-2">
              <h2 className="text-lg font-bold">Planned Safe Stops</h2>
              {plannedStops.map((stop) => (
                <SafeStopItem key={stop.id} stop={stop} />
              ))}
            </section>

            {driverSwitchStops.length > 0 && (
              <section className="rounded-xl border border-yellow-500 bg-slate-900 px-3 py-3">
                <h2 className="text-lg font-bold text-yellow-500">
                  Driver Switch Locations
                </h2>
                <div className="mt-2 flex flex-col gap-2">
                  {driverSwitchStops.map((stop) => (
                    <p key={stop.id} className="text-sm text-slate-300">
                      {stop.name}
                    </p>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </main>
  );
}

/**
 * A summary tile component displaying an icon, label, and value.
 */
function SummaryTile({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl bg-slate-800 px-3 py-3">
      <div className="mb-2 text-yellow-500">{icon}</div>
      <p className="text-xs font-semibold uppercase text-slate-400">{label}</p>
      <p className="mt-1 text-lg font-bold text-white">{value}</p>
    </div>
  );
}

/**
 * A component representing a safe stop item, displaying its name, distance, ETA, and facilities.
 */
function SafeStopItem({ stop }: { stop: PlannedSafeStop }) {
  return (
    <article className="rounded-xl bg-slate-800 px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-bold text-white">{stop.name}</h3>
          <p className="mt-1 text-sm text-slate-400">
            {stop.distanceKm} km away · ETA {stop.estimatedArrivalTime}
          </p>
          <p className="mt-1 text-xs text-slate-500">{stop.restBreak.reason}</p>
        </div>
        {stop.isDriverSwitchLocation && (
          <span className="shrink-0 rounded-full border border-yellow-500 px-2 py-1 text-xs font-bold text-yellow-500">
            Switch
          </span>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {stop.facilities.map((facility) => (
          <span
            key={facility}
            className="rounded-full bg-slate-900 px-2 py-1 text-xs font-semibold text-slate-300"
          >
            {facility}
          </span>
        ))}
      </div>
    </article>
  );
}
