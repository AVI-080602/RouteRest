/**
 * Which fuel station Rory suggests, and what it says about it
 * (utils/fuelStations.ts).
 *
 * Run: node --test tests/fuelStations.test.mjs   (Node 22.18 or later can
 * import the TypeScript file directly).
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  chooseFuelStation,
  describeFuelStation,
  fuelStationLabels,
} from "../utils/fuelStations.ts";

const station = (name, distance_km, tags = {}) => ({
  name,
  coordinate: { lat: -37.8, lng: 145 },
  distance_km,
  diesel: null,
  truck_diesel: null,
  truck_access: null,
  opening_hours: null,
  ...tags,
});

test("with nothing tagged, the nearest station is chosen", () => {
  const chosen = chooseFuelStation([station("Near", 2), station("Far", 9)]);
  assert.equal(chosen.name, "Near");
});

test("a station tagged for trucks is preferred when it is not much further", () => {
  const chosen = chooseFuelStation([
    station("Corner servo", 2),
    station("Truck stop", 12, { truck_access: true }),
  ]);
  assert.equal(chosen.name, "Truck stop");
});

test("but not when it is a long way further", () => {
  const chosen = chooseFuelStation([
    station("Corner servo", 2),
    station("Truck stop", 40, { truck_diesel: true }),
  ]);
  assert.equal(chosen.name, "Corner servo");
});

test("diesel being listed only wins a close call", () => {
  assert.equal(
    chooseFuelStation([
      station("No tags", 2),
      station("Diesel listed", 4, { diesel: true }),
    ]).name,
    "Diesel listed",
  );
  assert.equal(
    chooseFuelStation([
      station("No tags", 2),
      station("Diesel listed", 8, { diesel: true }),
    ]).name,
    "No tags",
  );
});

test("a station mapped as closed to trucks is never chosen", () => {
  assert.equal(
    chooseFuelStation([station("No trucks", 1, { truck_access: false })]),
    null,
  );
  assert.equal(
    chooseFuelStation([
      station("No trucks", 1, { truck_access: false }),
      station("Open", 5),
    ]).name,
    "Open",
  );
});

test("no stations means nothing to suggest", () => {
  assert.equal(chooseFuelStation([]), null);
});

test("the description always says when truck access is not confirmed", () => {
  assert.equal(
    describeFuelStation(station("BP", 2, { diesel: true })),
    "Diesel is listed. Truck access isn't confirmed.",
  );
  assert.equal(
    describeFuelStation(station("7-Eleven", 2)),
    "Diesel isn't listed on the map, though most stations sell it. Truck access isn't confirmed.",
  );
});

test("a truck stop is described as one", () => {
  assert.equal(
    describeFuelStation(
      station("Truck stop", 5, {
        truck_diesel: true,
        truck_access: true,
        opening_hours: "24/7",
      }),
    ),
    "It has truck diesel pumps. It's marked as open to trucks. It's open 24 hours.",
  );
});

test("the card shows only what the map says", () => {
  assert.deepEqual(fuelStationLabels(station("Plain", 2)), ["Fuel"]);
  assert.deepEqual(
    fuelStationLabels(
      station("Truck stop", 5, {
        truck_diesel: true,
        truck_access: true,
        opening_hours: "24/7",
      }),
    ),
    ["Fuel", "Diesel", "Truck diesel pumps", "Trucks welcome", "Open 24 hours"],
  );
});
