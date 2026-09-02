"use client";

import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import { RouteBreaksData } from "@/types/routeBreaks";

const MAPTILER_KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY;

/**
 * Returns the MapLibre style configuration for the map.
 */
function getMapStyle() {
  return {
    version: 8,
    sources: {
      "maptiler-streets": {
        type: "raster",
        tiles: [
          `https://api.maptiler.com/maps/streets-v2/256/{z}/{x}/{y}.png?key=${MAPTILER_KEY}`, // zoom in and zoom out
        ],
        tileSize: 256,
        attribution: "© MapTiler © OpenStreetMap contributors",
      },
    },
    layers: [
      // Background layer for the map.
      {
        id: "map-background",
        type: "background",
        paint: {
          "background-color": "#f8f4e3",
        },
      },
      // Raster layer for the MapTiler streets tiles.
      {
        id: "maptiler-streets-layer",
        type: "raster",
        source: "maptiler-streets",
      },
    ],
  } as maplibregl.StyleSpecification; // Cast the style object to the MapLibre GL style specification type.
}

type MapMarker = {
  label: string;
  coordinate: {
    lat: number;
    lng: number;
  };
  type: "departure" | "destination" | "rest";
};

/**
 * A React component that renders a MapLibre map with the planned route and markers.
 */
export default function RouteMap({ data }: { data: RouteBreaksData }) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null); // Reference to the MapLibre map instance.
  const [mapError, setMapError] = useState("");
  const [routePath, setRoutePath] = useState("");
  const [visibleMarkers, setVisibleMarkers] = useState<
    Array<MapMarker & { x: number; y: number }>
  >([]);

  // Do not initialize the map if the MapTiler key is missing, the container is not ready, the map is already initialized, or there is no route geometry.
  useEffect(() => {
    if (
      !MAPTILER_KEY ||
      !mapContainerRef.current ||
      mapRef.current ||
      data.routeGeometry.length === 0
    ) {
      return;
    }

    // convert the route geometry into an array of [longitude, latitude] coordinates for MapLibre.
    const routeCoordinates = data.routeGeometry.map((point) => [
      point.lng,
      point.lat,
    ]);

    const departurePoint = data.routeGeometry[0]; // temp depature point

    // Prepare the map markers for departure, destinations, and rest stops.
    const mapMarkers: MapMarker[] = [
      {
        label: "Start",
        coordinate: departurePoint,
        type: "departure",
      },
      // spread
      ...data.destinations.map((destination) => ({
        label: destination.label,
        coordinate: destination.coordinate,
        type: "destination" as const,
      })),
      ...data.restStops.map((stop) => ({
        label: stop.name,
        coordinate: stop.coordinate,
        type: "rest" as const,
      })),
    ];

    // Initialize the MapLibre map instance.
    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: getMapStyle(),
      center: routeCoordinates[0] as [number, number],
      zoom: 6,
      attributionControl: false,
    });

    mapRef.current = map; // Store the map instance in the ref for later use.
    map.addControl(new maplibregl.NavigationControl(), "top-right"); // Add zoom and rotation controls to the top-right corner of the map.
    map.addControl(new maplibregl.AttributionControl()); // Add a compact attribution to show license information.

    // Resize the map after mount so the canvas matches the Tailwind-sized container.
    requestAnimationFrame(() => map.resize());

    // Handle map errors by displaying a user-friendly message.
    map.on("error", (event) => {
      const message =
        event.error?.message ??
        "The map failed to load one of its styles, tiles, or layers."; // if event.error.message is not available, use this default message.

      setMapError(message);
    });

    function updateRouteOverlay() {
      const projectedRoute = routeCoordinates.map((coordinate) =>
        map.project(coordinate as [number, number]),
      );

      setRoutePath(
        projectedRoute
          .map(
            (point, index) =>
              `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`,
          )
          .join(" "),
      );

      setVisibleMarkers(
        mapMarkers.map((marker) => {
          const point = map.project([
            marker.coordinate.lng,
            marker.coordinate.lat,
          ]);

          return {
            ...marker,
            x: point.x,
            y: point.y,
          };
        }),
      );
    }

    // Draw the planned route and markers on top of the raster map.
    function drawRouteOverlay() {
      const routeBounds = routeCoordinates.reduce(
        (bounds, coordinate) => bounds.extend(coordinate as [number, number]),

        // Initialize the bounds with the first route coordinate.
        new maplibregl.LngLatBounds(
          routeCoordinates[0] as [number, number],
          routeCoordinates[0] as [number, number],
        ),
      );

      map.fitBounds(routeBounds, {
        padding: 36, // Add padding around the route bounds when fitting the map view.
        maxZoom: 8, // Limit the maximum zoom level when fitting the route bounds.
      });

      updateRouteOverlay();
      map.on("move", updateRouteOverlay);
      map.on("zoom", updateRouteOverlay);
      map.on("resize", updateRouteOverlay);
    }

    map.once("load", drawRouteOverlay);

    return () => {
      map.off("move", updateRouteOverlay);
      map.off("zoom", updateRouteOverlay);
      map.off("resize", updateRouteOverlay);
      map.remove();
      mapRef.current = null;
    };
  }, [data]);

  if (!MAPTILER_KEY) {
    return (
      <div className="flex h-72 flex-col justify-center rounded-xl border border-slate-700 bg-slate-950 px-4 text-center">
        <p className="font-bold text-white">Map key not configured</p>
        <p className="mt-2 text-sm text-slate-400">
          Add NEXT_PUBLIC_MAPTILER_KEY to your frontend .env.local file to show
          the live MapTiler map.
        </p>
      </div>
    );
  }

  return (
    // Render the map container and overlay elements.
    <div className="relative h-[560px] overflow-hidden rounded-xl border border-slate-700 bg-slate-950">
      <div
        ref={mapContainerRef}
        className="h-full w-full"
        aria-label="Map showing planned route, destinations, and rest stops"
      />

      <svg className="pointer-events-none absolute inset-0 z-10 h-full w-full">
        <path
          d={routePath}
          fill="none"
          stroke="#eab308"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="6"
        />
        <path
          d={routePath}
          fill="none"
          stroke="#020617"
          strokeDasharray="2 14"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
        />
      </svg>

      {visibleMarkers.map((marker) => (
        <div
          key={`${marker.type}-${marker.label}`}
          className={`pointer-events-none absolute z-20 flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-slate-950 text-xs font-extrabold text-slate-950 shadow-lg ${
            marker.type === "departure"
              ? "bg-white"
              : marker.type === "destination"
                ? "bg-yellow-500"
                : "bg-emerald-400"
          }`}
          style={{
            left: marker.x,
            top: marker.y,
          }}
          title={marker.label}
        >
          {marker.type === "departure"
            ? "S"
            : marker.type === "destination"
              ? "D"
              : "R"}
        </div>
      ))}

      <div className="pointer-events-none absolute left-3 top-3 z-10 rounded-xl bg-slate-950/90 px-3 py-2 text-xs text-slate-200 shadow-lg">
        <p className="font-bold text-white">Melbourne to Sydney</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <span>S Start</span>
          <span>D Destination</span>
          <span>R Rest stop</span>
        </div>
      </div>

      {mapError && (
        <div className="absolute bottom-3 left-3 right-3 z-10 rounded-xl border border-red-500 bg-slate-950/95 px-3 py-2 text-xs text-red-200">
          {mapError}
        </div>
      )}
    </div>
  );
}
