import { Coordinate } from "@/types/routeBreaks";

/**
 * Small, dependency-free geometry helpers shared by the Route & Breaks
 * page (ordering waypoints along a route) and in-app navigation (where
 * on the route the truck is, how far is left, is it off route).
 *
 * All distances are great-circle on a spherical Earth. That is accurate
 * to well under 0.5 percent over the distances a truck drives in a day,
 * which is far tighter than GPS itself.
 */

const EARTH_RADIUS_KM = 6371.0088;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
const toDegrees = (radians: number) => (radians * 180) / Math.PI;

/** Great-circle distance between two points, in kilometres. */
export function haversineKm(a: Coordinate, b: Coordinate): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing from a to b, degrees clockwise from north (0..360). */
export function bearingDegrees(a: Coordinate, b: Coordinate): number {
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const dLng = toRadians(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (toDegrees(Math.atan2(y, x)) + 360) % 360;
}

/**
 * Index of the polyline vertex closest to `point`. Used to order stops
 * and intermediate destinations by how far along the route they sit,
 * which is what a routing request needs (waypoints in visiting order).
 *
 * Vertex-only on purpose: route geometry from OpenRouteService is dense
 * (a vertex every few hundred metres at most), so the nearest vertex is
 * within GPS error of the nearest point on the line, and the comparison
 * can use a cheap equirectangular approximation instead of haversine.
 */
export function nearestVertexIndex(
  geometry: Coordinate[],
  point: Coordinate,
): number {
  if (geometry.length === 0) {
    return -1;
  }
  const cosLat = Math.cos(toRadians(point.lat));
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < geometry.length; i += 1) {
    const dLat = geometry[i].lat - point.lat;
    const dLng = (geometry[i].lng - point.lng) * cosLat;
    const d = dLat * dLat + dLng * dLng;
    if (d < bestDistance) {
      bestDistance = d;
      bestIndex = i;
    }
  }
  return bestIndex;
}

export type NearestPointResult = {
  // Index of the segment start vertex the nearest point lies on.
  index: number;
  // Distance from `point` to the route, in metres.
  distanceM: number;
  // Fraction (0..1) along the segment [index, index + 1].
  fraction: number;
};

/**
 * Nearest point on the polyline to `point`, checking each segment rather
 * than only its vertices. This is what off-route detection needs: on a
 * long straight highway the vertices can be a kilometre apart, and a
 * truck halfway between two of them is still exactly on the road.
 */
export function nearestPointOnPolyline(
  geometry: Coordinate[],
  point: Coordinate,
): NearestPointResult {
  if (geometry.length === 0) {
    return { index: -1, distanceM: Number.POSITIVE_INFINITY, fraction: 0 };
  }
  if (geometry.length === 1) {
    return {
      index: 0,
      distanceM: haversineKm(geometry[0], point) * 1000,
      fraction: 0,
    };
  }

  // Work in a local flat frame (metres) around the point. Fine at the
  // scale of a single road segment.
  const cosLat = Math.cos(toRadians(point.lat));
  const toXY = (c: Coordinate) => ({
    x: toRadians(c.lng - point.lng) * cosLat * EARTH_RADIUS_KM * 1000,
    y: toRadians(c.lat - point.lat) * EARTH_RADIUS_KM * 1000,
  });

  let best: NearestPointResult = {
    index: 0,
    distanceM: Number.POSITIVE_INFINITY,
    fraction: 0,
  };

  for (let i = 0; i < geometry.length - 1; i += 1) {
    const a = toXY(geometry[i]);
    const b = toXY(geometry[i + 1]);
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const lengthSq = abx * abx + aby * aby;
    // Projection of the origin (the point) onto segment ab, clamped.
    const t =
      lengthSq === 0
        ? 0
        : Math.max(0, Math.min(1, -(a.x * abx + a.y * aby) / lengthSq));
    const px = a.x + t * abx;
    const py = a.y + t * aby;
    const distance = Math.sqrt(px * px + py * py);
    if (distance < best.distanceM) {
      best = { index: i, distanceM: distance, fraction: t };
    }
  }

  return best;
}

/** Route length from the point at (index, fraction) to the end, in km. */
export function remainingDistanceKm(
  geometry: Coordinate[],
  index: number,
  fraction: number,
): number {
  if (index < 0 || geometry.length < 2) {
    return 0;
  }
  let total = 0;
  if (index < geometry.length - 1) {
    total += haversineKm(geometry[index], geometry[index + 1]) * (1 - fraction);
  }
  for (let i = index + 1; i < geometry.length - 1; i += 1) {
    total += haversineKm(geometry[i], geometry[i + 1]);
  }
  return total;
}

/** Total polyline length in km. */
export function polylineLengthKm(geometry: Coordinate[]): number {
  let total = 0;
  for (let i = 0; i < geometry.length - 1; i += 1) {
    total += haversineKm(geometry[i], geometry[i + 1]);
  }
  return total;
}

/**
 * A point `fraction` of the way from a to b along the straight line
 * between them. Good enough for simulating movement along one route
 * segment (used by the drive simulator, never for real positioning).
 */
export function interpolate(
  a: Coordinate,
  b: Coordinate,
  fraction: number,
): Coordinate {
  return {
    lat: a.lat + (b.lat - a.lat) * fraction,
    lng: a.lng + (b.lng - a.lng) * fraction,
  };
}

/** Moves a point `metres` in the direction `bearing` (degrees from north). */
export function offsetMetres(
  point: Coordinate,
  bearing: number,
  metres: number,
): Coordinate {
  const angular = metres / 1000 / EARTH_RADIUS_KM;
  const lat1 = toRadians(point.lat);
  const lng1 = toRadians(point.lng);
  const brng = toRadians(bearing);
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angular) +
      Math.cos(lat1) * Math.sin(angular) * Math.cos(brng),
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(brng) * Math.sin(angular) * Math.cos(lat1),
      Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2),
    );
  return { lat: toDegrees(lat2), lng: toDegrees(lng2) };
}

/**
 * The point `distanceKm` along the polyline from its start, clamped to
 * the ends, plus the bearing of the segment it lies on. Used by the drive
 * simulator to move a fake vehicle along the planned route at a steady
 * speed; never used for real positioning.
 */
export function pointAtDistance(
  geometry: Coordinate[],
  distanceKm: number,
): { point: Coordinate; bearing: number; index: number } {
  if (geometry.length === 0) {
    return { point: { lat: 0, lng: 0 }, bearing: 0, index: -1 };
  }
  if (geometry.length === 1 || distanceKm <= 0) {
    const bearing =
      geometry.length > 1 ? bearingDegrees(geometry[0], geometry[1]) : 0;
    return { point: geometry[0], bearing, index: 0 };
  }
  let remaining = distanceKm;
  for (let i = 0; i < geometry.length - 1; i += 1) {
    const segment = haversineKm(geometry[i], geometry[i + 1]);
    if (remaining <= segment && segment > 0) {
      return {
        point: interpolate(geometry[i], geometry[i + 1], remaining / segment),
        bearing: bearingDegrees(geometry[i], geometry[i + 1]),
        index: i,
      };
    }
    remaining -= segment;
  }
  const last = geometry.length - 1;
  return {
    point: geometry[last],
    bearing: bearingDegrees(geometry[last - 1], geometry[last]),
    index: last - 1,
  };
}
