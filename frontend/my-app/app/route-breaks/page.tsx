"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import {
  MapPin,
  Navigation,
  Route,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { JourneyDetails } from "@/types/journeyDetails";
import { PlannedSafeStop, RouteBreaksData } from "@/types/routeBreaks";

const LOCAL_STORAGE_KEY = "currentJourneyDetails";

/**
 * Subscribes to changes in the journey details stored in localStorage.
 * @param onStoreChange Callback to invoke when the storage changes.
 * @returns A function to unsubscribe from the storage event.
 */
function subscribeToJourneyStorage(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  return () => window.removeEventListener("storage", onStoreChange);
}

/**
 * Retrieves the saved journey details snapshot from localStorage.
 * @returns The JSON string of the saved journey details, or null if not found.
 */
function getSavedJourneySnapshot() {
  return localStorage.getItem(LOCAL_STORAGE_KEY);
}

/**
 * Provides a server-side snapshot of the journey details.
 * This is used to keep the server render consistent with the initial client render.
 * @returns Always returns null since localStorage is not available on the server.
 */
function getServerJourneySnapshot() {
  return null;
}

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
      isDriverSwitchLocation: false,
    },
    {
      id: "stop-2",
      name: "Pheasants Nest Service Centre",
      coordinate: { lat: -34.2558, lng: 150.6408 },
      distanceKm: 312,
      estimatedArrivalTime: "1:40 PM",
      facilities: ["Fuel", "Food", "Lighting", "Rest area"],
      isDriverSwitchLocation: true,
    },
  ],
  currentEta: "4:30 PM",
  currentActiveDriver: "Primary Driver",
};

export default function RouteBreaksPage() {
  // useSyncExternalStore keeps the server render and the first browser
  // render aligned, then reads localStorage after hydration.
  const savedJourney = useSyncExternalStore(
    subscribeToJourneyStorage,
    getSavedJourneySnapshot,
    getServerJourneySnapshot,
  );


  // Parse the saved journey details from localStorage, if available.
  const journeyDetails: JourneyDetails | null = savedJourney
    ? JSON.parse(savedJourney)
    : null;


  // Extract planned stops and driver switch stops from the mock data.
  const plannedStops = mockRouteBreaksData.restStops;
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
                  Preview
                </span>
              </div>

              <RouteMapPreview data={mockRouteBreaksData} />
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
 * A preview component for the route map, showing planned route, destinations, and stops.
 */
function RouteMapPreview({ data }: { data: RouteBreaksData }) {
  return (
    <div className="relative h-72 overflow-hidden rounded-xl border border-slate-700 bg-slate-950">
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(51,65,85,0.35)_1px,transparent_1px),linear-gradient(rgba(51,65,85,0.35)_1px,transparent_1px)] bg-[size:32px_32px]" />
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 320 260"
        aria-label="Preview map showing planned route, destinations, and stops"
      >
        <path
          d="M42 210 C95 170 112 135 150 130 C190 124 205 85 278 48"
          fill="none"
          stroke="#eab308"
          strokeLinecap="round"
          strokeWidth="6"
        />
        <path
          d="M42 210 C95 170 112 135 150 130 C190 124 205 85 278 48"
          fill="none"
          stroke="#f8fafc"
          strokeDasharray="4 14"
          strokeLinecap="round"
          strokeWidth="2"
        />
      </svg>

      <MapMarker className="left-[10%] top-[76%]" label="Start" />
      <MapMarker className="left-[45%] top-[48%]" label="Rest" tone="stop" />
      <MapMarker
        className="left-[64%] top-[32%]"
        label="Switch"
        tone="switch"
      />
      <MapMarker className="left-[83%] top-[14%]" label="Dest" />

      <div className="absolute bottom-3 left-3 right-3 rounded-xl bg-slate-900/90 px-3 py-2">
        <p className="text-xs font-semibold text-slate-400">Route points</p>
        <p className="text-sm text-white">
          {data.routeGeometry.length} geometry points ready for MapLibre
        </p>
      </div>
    </div>
  );
}

/**
 * A marker component for the map, indicating a specific point such as start, stop, or switch.
 */
function MapMarker({
  className,
  label,
  tone = "default",
}: {
  className: string;
  label: string;
  tone?: "default" | "stop" | "switch";
}) {
  const color =
    tone === "switch"
      ? "text-yellow-500"
      : tone === "stop"
        ? "text-emerald-400"
        : "text-white";

  return (
    <div
      className={`absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center ${className}`}
    >
      <MapPin className={`h-8 w-8 drop-shadow ${color}`} />
      <span className="rounded-full bg-slate-900 px-2 py-1 text-[10px] font-bold text-slate-200">
        {label}
      </span>
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
