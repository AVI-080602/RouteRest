"use client";

import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { Feature, LineString } from "geojson";
import {
  Coordinate,
  RouteBreaksData,
  VehiclePosition,
} from "@/types/routeBreaks";

const MAPTILER_KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY;

// MapLibre's own worker-URL detection breaks under Next's bundler (see
// scripts/copy-maplibre-worker.mjs for the full story): without this,
// GeoJSON sources never finish loading and the route line never draws.
// The file is copied into public/ on install, so this is a same-origin
// URL and MapLibre can start it as a module worker directly.
const MAPLIBRE_WORKER_URL = "/maplibre/maplibre-gl-worker.mjs";

// Brand tokens from globals.css, repeated as hex because MapLibre paint
// properties cannot read CSS classes.
const ROUTE_COLOR = "#15803d";
const ROUTE_CASING_COLOR = "#ffffff";

const ROUTE_SOURCE_ID = "route";
const ROUTE_CASING_LAYER_ID = "route-casing";
const ROUTE_LINE_LAYER_ID = "route-line";

// Somewhere over the middle of Australia, used only until the first real
// coordinate arrives so the driver never sees a blank grey square.
const AUSTRALIA_CENTER: [number, number] = [134.5, -28.0];

// Follow camera while navigating, modelled on phone navigation apps: the
// map turns so the direction of travel points up the screen, tilts so
// the road ahead recedes into the distance, and sits the vehicle in the
// lower part of the map so most of the view is road still to come.
const FOLLOW_PITCH_DEGREES = 45;
// Fraction of the map height the vehicle sits below the centre.
const FOLLOW_VEHICLE_OFFSET = 0.28;
// Long enough to glide between GPS fixes (about one a second), short
// enough that the camera never lags visibly behind the vehicle.
const FOLLOW_EASE_MS = 900;

/** Closer in at town speeds, where turns come quickly; further out on a
 * highway, where the next thing to see is a long way ahead. */
function followZoom(speedKmh: number | undefined) {
  if (speedKmh === undefined) return 16;
  if (speedKmh <= 25) return 17;
  if (speedKmh <= 55) return 16.3;
  if (speedKmh <= 85) return 15.5;
  return 14.8;
}

const EMPTY_LINE: Feature<LineString> = {
  type: "Feature",
  properties: {},
  geometry: { type: "LineString", coordinates: [] },
};

/**
 * The MapTiler Streets map, as vector tiles.
 *
 * It used to be the same map as pre-drawn 256 px pictures (raster tiles),
 * with the street names baked into each picture. That was fine while the
 * map was always north-up, but once the navigation map turns with the
 * direction of travel, every name turned with it: driving south, the
 * whole map read upside down. Vector tiles send the roads and the names
 * separately and MapLibre draws the names itself, upright however the
 * map is turned, and sharp at any zoom or tilt. Same provider, same key,
 * same look.
 */
function getMapStyleUrl() {
  return `https://api.maptiler.com/maps/streets-v2/style.json?key=${MAPTILER_KEY}`;
}

type MapMarker = {
  // A stable identity distinct from label: two rest stops can legitimately
  // share a name/coordinate, keying by label alone silently dropped one of
  // them via a key collision. id is always something already unique
  // upstream (a stop's own id, or the marker's index).
  id: string;
  label: string;
  coordinate: Coordinate;
  type: "departure" | "destination" | "rest";
  isWarned: boolean;
};

function buildMarkers(data: RouteBreaksData): MapMarker[] {
  const warned = new Set(data.warnedStopIds ?? []);
  return [
    ...(data.departure
      ? [
          {
            id: "departure",
            label: data.departure.label,
            coordinate: data.departure.coordinate,
            type: "departure" as const,
            isWarned: false,
          },
        ]
      : []),
    ...data.destinations.map((destination, index) => ({
      id: `destination-${index}`,
      label: destination.label,
      coordinate: destination.coordinate,
      type: "destination" as const,
      isWarned: false,
    })),
    ...data.restStops.map((stop) => ({
      id: stop.id,
      label: stop.name,
      coordinate: stop.coordinate,
      type: "rest" as const,
      isWarned: warned.has(stop.id),
    })),
  ];
}

const MARKER_BASE_CLASS =
  "flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border-2 text-xs font-extrabold shadow-lg";

function markerClassName(marker: MapMarker) {
  const byType =
    marker.type === "departure"
      ? "border-ink bg-white text-ink"
      : marker.type === "destination"
        ? "border-brand-strong bg-brand text-white"
        : "border-brand bg-brand-tint text-brand-strong";
  const warned = marker.isWarned
    ? " ring-2 ring-danger-line ring-offset-1"
    : "";
  return `${MARKER_BASE_CLASS} ${byType}${warned}`;
}

function markerGlyph(marker: MapMarker) {
  return marker.type === "departure"
    ? "S"
    : marker.type === "destination"
      ? "D"
      : "R";
}

/** Applies label, colours and glyph to a marker's DOM element. Used both
 * when a marker is created and when an existing one is updated in place,
 * so a stop that becomes warned (or stops being warned) changes colour
 * without being torn down. */
function applyMarkerStyle(element: HTMLElement, marker: MapMarker) {
  // The outer element belongs to MapLibre (it adds its own
  // "maplibregl-marker" classes and positions it with an inline
  // transform), so all styling goes on a child. Overwriting the outer
  // className on an update stripped MapLibre's classes off the marker.
  let circle = element.firstElementChild as HTMLElement | null;
  if (!circle) {
    circle = document.createElement("div");
    element.appendChild(circle);
  }
  circle.className = markerClassName(marker);
  circle.textContent = markerGlyph(marker);
  element.title = marker.label;
  element.setAttribute("aria-label", marker.label);
}

function createVehicleElement() {
  const element = document.createElement("div");
  element.className =
    "flex h-9 w-9 items-center justify-center rounded-full border-2 border-white bg-ink text-white shadow-lg";
  element.title = "Your position";
  element.setAttribute("aria-label", "Your position");
  // An arrow pointing up. The marker itself is rotated to the heading
  // (see Effect 4), not this SVG, so the arrow stays correct however the
  // map is turned.
  element.innerHTML =
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M12 2 4.5 20 12 16l7.5 4z"/></svg>';
  return element;
}

type Props = {
  data: RouteBreaksData;
  // Shown in the legend chip; replaces the caption that used to be
  // hardcoded to "Melbourne to Sydney" regardless of the journey.
  title: string;
  // The page owns the height so the same component can be a stacked
  // block on a phone and a viewport-tall sticky column on a laptop.
  className?: string;
  // Where to centre the empty map before geometry arrives, typically the
  // departure. Read once at creation.
  initialCenter?: Coordinate | null;
  // Dims the route line while a replacement route is being fetched.
  isRoutePending?: boolean;
  // Live position while navigating (PR 3). null hides the marker.
  vehiclePosition?: VehiclePosition | null;
  // Keep the camera on the vehicle as it moves.
  followMode?: boolean;
  // Fired when the driver pans or zooms by hand, so the page can pause
  // follow mode until they ask for it back.
  onUserInteraction?: () => void;
  // While navigating: how far along the route the vehicle is, as the
  // segment index and fraction nearestPointOnPolyline returns. The line
  // is then drawn only from the vehicle onwards, so the part already
  // driven disappears. Omitted on Route & Breaks, which shows it all.
  routeProgress?: { index: number; fraction: number } | null;
};

/**
 * MapLibre map of the planned route, its markers and (while navigating)
 * the vehicle.
 *
 * The map is created exactly once for the component's lifetime and then
 * UPDATED in place when the data changes. The previous version tore the
 * whole map down and rebuilt it on every data change, and drew the route
 * as an SVG overlay re-projected through React state, which lagged the
 * canvas by a frame and only started listening after the map's load
 * event. Any container resize therefore left the line floating off the
 * roads (BA item 10). A GeoJSON source and line layers are re-projected
 * by MapLibre itself on every frame, so they cannot desynchronise, and
 * MapLibre observes the container's size on its own (trackResize).
 */
export default function RouteMap({
  data,
  title,
  className = "h-[560px]",
  initialCenter = null,
  isRoutePending = false,
  vehiclePosition = null,
  followMode = false,
  onUserInteraction,
  routeProgress = null,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const vehicleMarkerRef = useRef<maplibregl.Marker | null>(null);
  // Key of the journey whose bounds were last fitted, so a detour or a
  // stop swap (same endpoints) keeps the driver's own pan and zoom.
  const lastFitKeyRef = useRef<string>("");
  // Latest callback, read by map event handlers registered once at
  // creation. Kept in a ref (updated in an effect, never during render)
  // so those handlers see the current prop without re-registering.
  const onUserInteractionRef = useRef(onUserInteraction);
  useEffect(() => {
    onUserInteractionRef.current = onUserInteraction;
  }, [onUserInteraction]);

  const [isStyleReady, setIsStyleReady] = useState(false);
  const [mapError, setMapError] = useState("");

  // Effect 1: create the map once.
  useEffect(() => {
    if (!MAPTILER_KEY || !containerRef.current || mapRef.current) {
      return;
    }

    maplibregl.setWorkerUrl(MAPLIBRE_WORKER_URL);

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: getMapStyleUrl(),
      center: initialCenter
        ? [initialCenter.lng, initialCenter.lat]
        : AUSTRALIA_CENTER,
      zoom: initialCenter ? 7 : 3.5,
      attributionControl: false,
    });
    mapRef.current = map;

    // Dev-only handle so browser tests can inspect the live map (source
    // data, layers, camera) without the app exposing anything in
    // production builds.
    if (process.env.NODE_ENV !== "production") {
      (
        window as unknown as { __routeRestMap?: maplibregl.Map }
      ).__routeRestMap = map;
    }

    // No compass: rotating the map has no meaning for a route plan and
    // the bearing button read as a "button with no purpose" (BA item 9).
    map.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      "top-right",
    );
    map.addControl(new maplibregl.FullscreenControl(), "top-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true }));

    map.on("error", (event) => {
      setMapError(
        event.error?.message ??
          "The map failed to load one of its styles, tiles, or layers.",
      );
    });

    // Only the driver's own gestures count as interaction. Follow mode's
    // easeTo calls fire the same start events, but without an
    // originalEvent, which is how the two are told apart. Pinch zoom,
    // two-finger rotate and tilt on a phone all count; before, only a
    // drag or a mouse wheel did, so a pinch was fought by the camera.
    const onGesture = (event: { originalEvent?: unknown }) => {
      if (event.originalEvent) {
        onUserInteractionRef.current?.();
      }
    };
    map.on("dragstart", onGesture);
    map.on("zoomstart", onGesture);
    map.on("rotatestart", onGesture);
    map.on("pitchstart", onGesture);

    // style.load fires as soon as the style JSON is parsed, which is all
    // that adding sources and layers needs. The later `load` event waits
    // for every visible tile to download as well, which on a slow
    // connection left the route and markers invisible for many seconds
    // after the map itself was on screen.
    map.once("style.load", () => {
      // The route goes under the map's first label layer, so street and
      // place names stay readable on top of the green line (as in phone
      // navigation apps) instead of being hidden underneath it.
      const firstLabelLayerId = map
        .getStyle()
        .layers.find((layer) => layer.type === "symbol")?.id;
      map.addSource(ROUTE_SOURCE_ID, { type: "geojson", data: EMPTY_LINE });
      map.addLayer(
        {
          id: ROUTE_CASING_LAYER_ID,
          type: "line",
          source: ROUTE_SOURCE_ID,
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": ROUTE_CASING_COLOR, "line-width": 9 },
        },
        firstLabelLayerId,
      );
      map.addLayer(
        {
          id: ROUTE_LINE_LAYER_ID,
          type: "line",
          source: ROUTE_SOURCE_ID,
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": ROUTE_COLOR, "line-width": 5 },
        },
        firstLabelLayerId,
      );
      setIsStyleReady(true);
    });

    // MapLibre's own trackResize already watches the container. This
    // observer is a belt-and-braces for parents that toggle display or
    // change size without a layout event reaching MapLibre.
    const observer = new ResizeObserver(() => map.resize());
    observer.observe(containerRef.current);

    const markers = markersRef.current;
    return () => {
      observer.disconnect();
      markers.forEach((marker) => marker.remove());
      markers.clear();
      vehicleMarkerRef.current?.remove();
      vehicleMarkerRef.current = null;
      map.remove();
      mapRef.current = null;
      setIsStyleReady(false);
    };
    // initialCenter is intentionally read only at creation time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Effect 2: push data into the existing map.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isStyleReady) {
      return;
    }

    // The line itself is drawn by Effect 5, which also trims it while
    // navigating. The full geometry is still what the camera fits below.
    const coordinates = data.routeGeometry.map(
      (point) => [point.lng, point.lat] as [number, number],
    );

    // Markers, diffed by stable id so an unchanged marker is left alone.
    const wanted = buildMarkers(data);
    const seen = new Set<string>();
    for (const marker of wanted) {
      seen.add(marker.id);
      const lngLat: [number, number] = [
        marker.coordinate.lng,
        marker.coordinate.lat,
      ];
      const existing = markersRef.current.get(marker.id);
      if (existing) {
        existing.setLngLat(lngLat);
        applyMarkerStyle(existing.getElement(), marker);
        existing.getPopup()?.setText(marker.label);
      } else {
        const element = document.createElement("div");
        applyMarkerStyle(element, marker);
        const created = new maplibregl.Marker({ element })
          .setLngLat(lngLat)
          .setPopup(
            new maplibregl.Popup({ closeButton: false, offset: 18 }).setText(
              marker.label,
            ),
          )
          .addTo(map);
        markersRef.current.set(marker.id, created);
      }
    }
    for (const [id, marker] of markersRef.current) {
      if (!seen.has(id)) {
        marker.remove();
        markersRef.current.delete(id);
      }
    }

    // Fit the camera only when the journey's endpoints change. A detour
    // through a different rest stop keeps the same endpoints, so the
    // driver's pan and zoom survive it.
    if (coordinates.length > 0) {
      const first = coordinates[0];
      const last = coordinates[coordinates.length - 1];
      const fitKey = `${first.join(",")}|${last.join(",")}`;
      if (fitKey !== lastFitKeyRef.current) {
        // Recorded even when follow mode skips the fit. Otherwise the key
        // stayed unset while following, and the moment a driver touched
        // the map to look around (which turns follow mode off) this
        // effect saw a "new" journey and zoomed out to the whole route.
        lastFitKeyRef.current = fitKey;
        // Follow mode owns the camera while navigating; never fight it.
        if (!followMode) {
          const bounds = coordinates.reduce(
            (acc, coordinate) => acc.extend(coordinate),
            new maplibregl.LngLatBounds(first, first),
          );
          map.fitBounds(bounds, { padding: 36, maxZoom: 8 });
        }
      }
    }
  }, [data, isStyleReady, followMode]);

  // Effect 5: the route line. While navigating only the part still ahead
  // is drawn, starting exactly where the vehicle is, so the road already
  // covered disappears as the truck drives it. setData replaces the line
  // outright; MapLibre re-tiles a GeoJSON line of a few thousand points
  // in well under a frame, which is fine at one GPS fix a second.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isStyleReady) {
      return;
    }
    const geometry = data.routeGeometry;
    let ahead = geometry;
    if (
      routeProgress &&
      routeProgress.index >= 0 &&
      routeProgress.index < geometry.length - 1
    ) {
      const from = geometry[routeProgress.index];
      const to = geometry[routeProgress.index + 1];
      const vehicleOnLine = {
        lat: from.lat + (to.lat - from.lat) * routeProgress.fraction,
        lng: from.lng + (to.lng - from.lng) * routeProgress.fraction,
      };
      ahead = [vehicleOnLine, ...geometry.slice(routeProgress.index + 1)];
    }
    const source = map.getSource(ROUTE_SOURCE_ID) as
      maplibregl.GeoJSONSource | undefined;
    source?.setData({
      ...EMPTY_LINE,
      geometry: {
        type: "LineString",
        coordinates: ahead.map((point) => [point.lng, point.lat]),
      },
    });
  }, [data.routeGeometry, routeProgress, isStyleReady]);

  // Effect 3: dim the line while a replacement route is in flight.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isStyleReady) {
      return;
    }
    map.setPaintProperty(
      ROUTE_LINE_LAYER_ID,
      "line-opacity",
      isRoutePending ? 0.4 : 1,
    );
  }, [isRoutePending, isStyleReady]);

  // Effect 4: the vehicle marker and follow camera.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isStyleReady) {
      return;
    }

    if (!vehiclePosition) {
      vehicleMarkerRef.current?.remove();
      vehicleMarkerRef.current = null;
      return;
    }

    const lngLat: [number, number] = [vehiclePosition.lng, vehiclePosition.lat];
    if (!vehicleMarkerRef.current) {
      vehicleMarkerRef.current = new maplibregl.Marker({
        element: createVehicleElement(),
        // Rotation is measured against the map, not the screen, so an
        // arrow set to the heading points along the road whether the map
        // is north-up or turned. Rotating the SVG by the heading assumed
        // a north-up map and pointed the wrong way once the map turned.
        rotationAlignment: "map",
        pitchAlignment: "map",
      })
        .setLngLat(lngLat)
        .addTo(map);
    } else {
      vehicleMarkerRef.current.setLngLat(lngLat);
    }
    // No heading yet (the very first fix): leave the arrow where it is
    // rather than snapping it to north.
    if (vehiclePosition.heading !== undefined) {
      vehicleMarkerRef.current.setRotation(vehiclePosition.heading);
    }

    if (followMode) {
      map.easeTo({
        center: lngLat,
        // Direction of travel up the screen. Without a heading, keep the
        // map turned the way it already is.
        bearing: vehiclePosition.heading ?? map.getBearing(),
        pitch: FOLLOW_PITCH_DEGREES,
        zoom: followZoom(vehiclePosition.speedKmh),
        // Positive y puts the vehicle below the centre of the map.
        offset: [0, map.getContainer().clientHeight * FOLLOW_VEHICLE_OFFSET],
        duration: FOLLOW_EASE_MS,
        // Linear, so consecutive fixes join into one steady glide
        // instead of speeding up and slowing down every second.
        easing: (t) => t,
      });
    }
  }, [vehiclePosition, followMode, isStyleReady]);

  if (!MAPTILER_KEY) {
    return (
      <div
        className={`flex flex-col justify-center rounded-xl border border-line bg-surface-alt px-4 text-center ${className}`}
      >
        <p className="font-bold text-ink">Map key not configured</p>
        <p className="mt-2 text-sm text-muted">
          Add NEXT_PUBLIC_MAPTILER_KEY to your frontend .env.local file to show
          the live MapTiler map.
        </p>
      </div>
    );
  }

  return (
    <div
      className={`relative overflow-hidden rounded-xl border border-line bg-surface-alt ${className}`}
    >
      <div
        ref={containerRef}
        className="h-full w-full"
        aria-label="Map showing planned route, destinations, and rest stops"
      />

      <div className="pointer-events-none absolute left-3 top-3 z-10 max-w-[70%] rounded-xl border border-line bg-surface/95 px-3 py-2 text-xs text-muted shadow">
        <p className="truncate font-bold text-ink" title={title}>
          {title}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <span>S Start</span>
          <span>D Destination</span>
          <span>R Rest stop</span>
        </div>
      </div>

      {mapError && (
        <div className="absolute bottom-3 left-3 right-3 z-10 rounded-xl border border-danger-line bg-surface/95 px-3 py-2 text-xs text-danger">
          {mapError}
        </div>
      )}
    </div>
  );
}
