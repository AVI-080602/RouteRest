import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Run the browser storage modules against isolated in-memory storage.
function harness() {
  const entries = new Map();
  const writes = [];
  const browser = {
    localStorage: {
      getItem: (key) => entries.get(key) ?? null,
      setItem(key, value) {
        entries.set(key, value);
        writes.push(key);
      },
      removeItem(key) {
        entries.delete(key);
      },
    },
  };
  const cache = new Map();
  function loadModule(relativePath) {
    if (cache.has(relativePath)) return cache.get(relativePath);
    const compiledModule = { exports: {} };
    cache.set(relativePath, compiledModule.exports);
    const code = ts.transpileModule(
      readFileSync(resolve(root, relativePath), "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
        },
      },
    ).outputText;
    vm.runInNewContext(
      code,
      {
        module: compiledModule,
        exports: compiledModule.exports,
        window: browser,
        localStorage: browser.localStorage,
        require(name) {
          assert.ok(name.startsWith("@/"), `Unexpected import: ${name}`);
          return loadModule(`${name.slice(2)}.ts`);
        },
      },
      { filename: relativePath },
    );
    return compiledModule.exports;
  }
  return {
    ...loadModule("utils/journeyPerformance.ts"),
    ...loadModule("utils/journeyPerformanceStorage.ts"),
    ...loadModule("utils/afterRestStorage.ts"),
    ...loadModule("utils/afterRestSession.ts"),
    entries,
    writes,
    browser,
  };
}

function plan() {
  return {
    journeyId: "92a359b1-07b1-40ca-8c78-f26e71901744",
    createdAt: "2026-10-08T08:00:00.000Z",
    departureDateTime: "2026-10-08T08:00:00",
    waypoints: [
      { id: "departure", kind: "departure" },
      {
        id: "rest-1",
        kind: "stop",
        restBreak: {
          start: "2026-10-08T09:00:00Z",
          end: "2026-10-08T09:15:00Z",
          reason: "Planned break",
        },
      },
      { id: "destination", kind: "destination" },
    ],
    geometry: [],
    steps: [],
    distanceKm: 100,
    durationHours: 2,
  };
}

function stateCheck(updatedAt = "2026-10-08T07:55:00.000Z") {
  return {
    value: "very_sleepy",
    label: "Very Sleepy",
    source: "Self-report",
    updatedAt,
    context: "pre-departure",
  };
}

test("initializes the journey and snapshots planned rest duration", () => {
  const { initializeJourneyPerformance, loadJourneyPerformance } = harness();
  const navigation = plan();
  const record = initializeJourneyPerformance(navigation, stateCheck());
  assert.equal(record.journeyId, navigation.journeyId);
  assert.equal(record.startedAt, navigation.createdAt);
  assert.equal(record.schemaVersion, 1);
  assert.equal(record.scoringVersion, "v1");
  assert.equal(record.status, "in_progress");
  assert.equal(record.completedAt, null);
  assert.equal(record.isSimulation, false);
  assert.equal(record.rests.length, 1);
  assert.equal(record.rests[0].waypointId, "rest-1");
  assert.equal(record.rests[0].requiredMinutes, 15);
  assert.equal(record.rests[0].actualMinutes, null);
  assert.equal(record.rests[0].status, "planned");
  assert.equal(record.rests[0].afterRestCheck, null);
  assert.equal(
    JSON.stringify(loadJourneyPerformance(navigation.journeyId)),
    JSON.stringify(record),
  );
});

for (const value of [
  "not_sleepy",
  "slightly_sleepy",
  "very_sleepy",
  "dozing_off",
]) {
  test(`check completion does not depend on reporting ${value}`, () => {
    const check = { ...stateCheck(), value };
    const record = harness().createJourneyPerformanceRecord(plan(), check);
    assert.equal(record.preDepartureCheck.completed, true);
    assert.equal(record.preDepartureCheck.completedAt, check.updatedAt);
    assert.equal("value" in record.preDepartureCheck, false);
  });
}

test("accepts the exact four-hour age boundary", () => {
  const record = harness().createJourneyPerformanceRecord(
    plan(),
    stateCheck("2026-10-08T04:00:00.000Z"),
  );
  assert.equal(record.preDepartureCheck.completed, true);
});

for (const [name, check] of [
  ["missing", null],
  ["expired", stateCheck("2026-10-08T03:59:59.999Z")],
  ["future-dated", stateCheck("2026-10-08T08:00:00.001Z")],
  ["invalid timestamp", stateCheck("bad-date")],
  [
    "after-rest instead of pre-departure",
    { ...stateCheck(), context: "after-rest" },
  ],
]) {
  test(`a ${name} check stays unknown rather than scoring as missed`, () => {
    const record = harness().createJourneyPerformanceRecord(plan(), check);
    assert.equal(record.preDepartureCheck.completed, null);
    assert.equal(record.preDepartureCheck.completedAt, null);
  });
}

test("a later state check cannot mutate the stored snapshot", () => {
  const { initializeJourneyPerformance, loadJourneyPerformance } = harness();
  const check = stateCheck();
  const navigation = plan();
  initializeJourneyPerformance(navigation, check);
  check.context = "after-rest";
  check.updatedAt = "2026-10-08T10:00:00.000Z";
  assert.equal(
    loadJourneyPerformance(navigation.journeyId).preDepartureCheck.completedAt,
    "2026-10-08T07:55:00.000Z",
  );
});

test("destinations and fuel-only stops are not planned rest obligations", () => {
  const navigation = plan();
  navigation.waypoints.push({ id: "fuel-only", kind: "stop" });
  const record = harness().createJourneyPerformanceRecord(navigation, null);
  assert.equal(record.rests.length, 1);
});

test("a journey without rests has an empty rest snapshot", () => {
  const navigation = plan();
  navigation.waypoints.splice(1, 1);
  assert.equal(
    harness().createJourneyPerformanceRecord(navigation, null).rests.length,
    0,
  );
});

test("refresh, resume or reroute never overwrite an existing record", () => {
  const { initializeJourneyPerformance, saveJourneyPerformance, writes } =
    harness();
  const navigation = plan();
  const original = initializeJourneyPerformance(navigation, stateCheck());
  original.rests[0].status = "completed";
  original.rests[0].actualMinutes = 17;
  saveJourneyPerformance(original);
  const writeCount = writes.length;
  navigation.waypoints[1].restBreak.end = "2026-10-08T09:30:00Z";
  const reloaded = initializeJourneyPerformance(navigation, null);
  assert.equal(writes.length, writeCount);
  assert.equal(reloaded.rests[0].requiredMinutes, 15);
  assert.equal(reloaded.rests[0].actualMinutes, 17);
  assert.equal(reloaded.preDepartureCheck.completed, true);
});

test("two journeys have independent records", () => {
  const { initializeJourneyPerformance, loadJourneyPerformance, writes } =
    harness();
  const first = plan();
  const second = {
    ...plan(),
    journeyId: "b8c247b2-f6fa-4316-933e-9920a4620f24",
  };
  initializeJourneyPerformance(first, stateCheck());
  initializeJourneyPerformance(second, null);
  assert.equal(writes.length, 2);
  assert.equal(
    loadJourneyPerformance(first.journeyId).preDepartureCheck.completed,
    true,
  );
  assert.equal(
    loadJourneyPerformance(second.journeyId).preDepartureCheck.completed,
    null,
  );
});

for (const [name, end] of [
  ["zero", "2026-10-08T09:00:00Z"],
  ["negative", "2026-10-08T08:59:00Z"],
  ["invalid", "bad-date"],
]) {
  test(`rejects a ${name} planned duration without writing`, () => {
    const { initializeJourneyPerformance, writes } = harness();
    const navigation = plan();
    navigation.waypoints[1].restBreak.end = end;
    assert.throws(
      () => initializeJourneyPerformance(navigation, null),
      /invalid duration/,
    );
    assert.equal(writes.length, 0);
  });
}

test("rejects duplicate rest IDs", () => {
  const navigation = plan();
  navigation.waypoints.push({ ...navigation.waypoints[1] });
  assert.throws(
    () => harness().createJourneyPerformanceRecord(navigation, null),
    /duplicate rest IDs/,
  );
});

test("rejects an invalid navigation start time", () => {
  const navigation = { ...plan(), createdAt: "bad-date" };
  assert.throws(
    () => harness().createJourneyPerformanceRecord(navigation, null),
    /invalid start time/,
  );
});

test("a legacy plan needs a journey ID", () => {
  const navigation = plan();
  delete navigation.journeyId;
  assert.throws(
    () => harness().createJourneyPerformanceRecord(navigation, null),
    /journey ID is required/,
  );
});

test("missing data returns null, but corrupt records cannot be reinitialized", () => {
  const {
    loadJourneyPerformance,
    initializeJourneyPerformance,
    entries,
    writes,
  } = harness();
  const navigation = plan();
  assert.equal(loadJourneyPerformance(navigation.journeyId), null);
  entries.set(`journeyPerformance:v1:${navigation.journeyId}`, "null");
  assert.throws(
    () => initializeJourneyPerformance(navigation, stateCheck()),
    /cannot be null/,
  );
  assert.equal(writes.length, 0);
});

test("mismatched journey records are rejected instead of overwritten", () => {
  const {
    initializeJourneyPerformance,
    entries,
    writes,
    createJourneyPerformanceRecord,
  } = harness();
  const navigation = plan();
  const wrong = createJourneyPerformanceRecord(
    { ...navigation, journeyId: "other" },
    null,
  );
  entries.set(
    `journeyPerformance:v1:${navigation.journeyId}`,
    JSON.stringify(wrong),
  );
  assert.throws(
    () => initializeJourneyPerformance(navigation, null),
    /mismatched/,
  );
  assert.equal(writes.length, 0);
});

test("storage failures are not swallowed", () => {
  const { initializeJourneyPerformance, browser } = harness();
  browser.localStorage.setItem = () => {
    throw new Error("Storage blocked");
  };
  assert.throws(
    () => initializeJourneyPerformance(plan(), stateCheck()),
    /Storage blocked/,
  );
});

function initializedJourney() {
  const api = harness();
  const navigation = plan();
  api.initializeJourneyPerformance(navigation, stateCheck());
  return { ...api, navigation };
}

function afterRestCheck(updatedAt = "2026-10-08T09:20:00.000Z") {
  return { ...stateCheck(updatedAt), context: "after-rest" };
}

test("starting a rest changes only its status and keeps the departure snapshot", () => {
  const { startPerformanceRest, navigation } = initializedJourney();
  const record = startPerformanceRest(navigation.journeyId, "rest-1");
  assert.equal(record.rests[0].status, "resting");
  assert.equal(record.rests[0].actualMinutes, null);
  assert.equal(record.rests[0].requiredMinutes, 15);
  assert.equal(record.rests[0].afterRestCheck, null);
  assert.equal(record.preDepartureCheck.completedAt, stateCheck().updatedAt);
});

test("a duplicate rest start is a no-op", () => {
  const { startPerformanceRest, navigation, writes } = initializedJourney();
  startPerformanceRest(navigation.journeyId, "rest-1");
  const count = writes.length;
  startPerformanceRest(navigation.journeyId, "rest-1");
  assert.equal(writes.length, count);
});

test("finishing a short rest preserves fractional minutes and creates an unknown check", () => {
  const { startPerformanceRest, finishPerformanceRest, navigation } =
    initializedJourney();
  startPerformanceRest(navigation.journeyId, "rest-1");
  const record = finishPerformanceRest(navigation.journeyId, "rest-1", 7.25);
  assert.equal(record.rests[0].status, "completed");
  assert.equal(record.rests[0].actualMinutes, 7.25);
  assert.equal(record.rests[0].afterRestCheck.completed, null);
  assert.equal(record.rests[0].afterRestCheck.completedAt, null);
});

test("zero recorded minutes is valid after a rest was started", () => {
  const { startPerformanceRest, finishPerformanceRest, navigation } =
    initializedJourney();
  startPerformanceRest(navigation.journeyId, "rest-1");
  assert.equal(
    finishPerformanceRest(navigation.journeyId, "rest-1", 0).rests[0]
      .actualMinutes,
    0,
  );
});

for (const minutes of [-1, NaN, Infinity, -Infinity, "15"]) {
  test(`rejects invalid actual minutes ${String(minutes)} without writing`, () => {
    const { startPerformanceRest, finishPerformanceRest, navigation, writes } =
      initializedJourney();
    startPerformanceRest(navigation.journeyId, "rest-1");
    const count = writes.length;
    assert.throws(
      () => finishPerformanceRest(navigation.journeyId, "rest-1", minutes),
      /finite and non-negative/,
    );
    assert.equal(writes.length, count);
  });
}

test("cannot finish a rest before starting it", () => {
  const { finishPerformanceRest, navigation, writes } = initializedJourney();
  const count = writes.length;
  assert.throws(
    () => finishPerformanceRest(navigation.journeyId, "rest-1", 15),
    /Start the rest/,
  );
  assert.equal(writes.length, count);
});

test("duplicate finish does not add minutes or erase a completed check", () => {
  const api = initializedJourney();
  const id = api.navigation.journeyId;
  api.startPerformanceRest(id, "rest-1");
  api.finishPerformanceRest(id, "rest-1", 15);
  api.completePerformanceRestCheck(id, "rest-1", afterRestCheck());
  const count = api.writes.length;
  const record = api.finishPerformanceRest(id, "rest-1", 15);
  assert.equal(api.writes.length, count);
  assert.equal(record.rests[0].actualMinutes, 15);
  assert.equal(record.rests[0].afterRestCheck.completed, true);
});

test("a different finish total needs a new rest session", () => {
  const api = initializedJourney();
  const id = api.navigation.journeyId;
  api.startPerformanceRest(id, "rest-1");
  api.finishPerformanceRest(id, "rest-1", 10);
  assert.throws(
    () => api.finishPerformanceRest(id, "rest-1", 15),
    /Start the rest/,
  );
});

test("resuming keeps minutes, invalidates the old check and saves an absolute total", () => {
  const api = initializedJourney();
  const id = api.navigation.journeyId;
  api.startPerformanceRest(id, "rest-1");
  api.finishPerformanceRest(id, "rest-1", 10);
  api.completePerformanceRestCheck(id, "rest-1", afterRestCheck());
  const restarted = api.startPerformanceRest(id, "rest-1");
  assert.equal(restarted.rests[0].actualMinutes, 10);
  assert.equal(restarted.rests[0].afterRestCheck, null);
  const finished = api.finishPerformanceRest(id, "rest-1", 16.5);
  assert.equal(finished.rests[0].actualMinutes, 16.5);
  assert.equal(finished.rests[0].afterRestCheck.completed, null);
});

test("cumulative minutes cannot decrease after resuming", () => {
  const api = initializedJourney();
  const id = api.navigation.journeyId;
  api.startPerformanceRest(id, "rest-1");
  api.finishPerformanceRest(id, "rest-1", 10);
  api.startPerformanceRest(id, "rest-1");
  const count = api.writes.length;
  assert.throws(
    () => api.finishPerformanceRest(id, "rest-1", 9),
    /cannot decrease/,
  );
  assert.equal(api.writes.length, count);
});

for (const value of [
  "not_sleepy",
  "slightly_sleepy",
  "very_sleepy",
  "dozing_off",
]) {
  test(`after-rest checking counts completion when the answer is ${value}`, () => {
    const api = initializedJourney();
    const id = api.navigation.journeyId;
    api.startPerformanceRest(id, "rest-1");
    api.finishPerformanceRest(id, "rest-1", 15);
    const check = { ...afterRestCheck(), value };
    const record = api.completePerformanceRestCheck(id, "rest-1", check);
    assert.equal(record.rests[0].afterRestCheck.completed, true);
    assert.equal(record.rests[0].afterRestCheck.completedAt, check.updatedAt);
    assert.equal("value" in record.rests[0].afterRestCheck, false);
  });
}

for (const status of ["planned", "resting"]) {
  test(`cannot record an after-rest check while the rest is ${status}`, () => {
    const api = initializedJourney();
    const id = api.navigation.journeyId;
    if (status === "resting") api.startPerformanceRest(id, "rest-1");
    const count = api.writes.length;
    assert.throws(
      () => api.completePerformanceRestCheck(id, "rest-1", afterRestCheck()),
      /Finish the rest/,
    );
    assert.equal(api.writes.length, count);
  });
}

for (const [name, check] of [
  ["pre-departure context", stateCheck()],
  ["invalid timestamp", afterRestCheck("bad-date")],
  ["before this journey", afterRestCheck("2026-10-08T07:59:59.999Z")],
]) {
  test(`rejects an after-rest check with ${name}`, () => {
    const api = initializedJourney();
    const id = api.navigation.journeyId;
    api.startPerformanceRest(id, "rest-1");
    api.finishPerformanceRest(id, "rest-1", 15);
    const count = api.writes.length;
    assert.throws(
      () => api.completePerformanceRestCheck(id, "rest-1", check),
      /valid after-rest check/,
    );
    assert.equal(api.writes.length, count);
  });
}

test("duplicate checks are no-ops and older checks cannot replace newer ones", () => {
  const api = initializedJourney();
  const id = api.navigation.journeyId;
  api.startPerformanceRest(id, "rest-1");
  api.finishPerformanceRest(id, "rest-1", 15);
  api.completePerformanceRestCheck(id, "rest-1", afterRestCheck());
  const count = api.writes.length;
  api.completePerformanceRestCheck(id, "rest-1", afterRestCheck());
  assert.equal(api.writes.length, count);
  assert.throws(
    () =>
      api.completePerformanceRestCheck(
        id,
        "rest-1",
        afterRestCheck("2026-10-08T09:19:00Z"),
      ),
    /older check/,
  );
  assert.equal(api.writes.length, count);
  const updated = api.completePerformanceRestCheck(
    id,
    "rest-1",
    afterRestCheck("2026-10-08T09:21:00Z"),
  );
  assert.equal(
    updated.rests[0].afterRestCheck.completedAt,
    "2026-10-08T09:21:00Z",
  );
});

const updateOperations = [
  ["start", (api, id, stop) => api.startPerformanceRest(id, stop)],
  ["finish", (api, id, stop) => api.finishPerformanceRest(id, stop, 15)],
  [
    "check",
    (api, id, stop) =>
      api.completePerformanceRestCheck(id, stop, afterRestCheck()),
  ],
];

for (const [name, update] of updateOperations) {
  test(`${name} rejects an uninitialized journey`, () => {
    const api = harness();
    assert.throws(
      () => update(api, "missing", "rest-1"),
      /not been initialized/,
    );
    assert.equal(api.writes.length, 0);
  });
  test(`${name} rejects a waypoint outside the specified journey`, () => {
    const api = initializedJourney();
    const count = api.writes.length;
    assert.throws(
      () => update(api, api.navigation.journeyId, "other-rest"),
      /exactly one matching/,
    );
    assert.equal(api.writes.length, count);
  });
  test(`${name} cannot edit a completed journey`, () => {
    const api = initializedJourney();
    const id = api.navigation.journeyId;
    const record = api.loadJourneyPerformance(id);
    record.status = "completed";
    record.completedAt = "2026-10-08T10:00:00Z";
    api.saveJourneyPerformance(record);
    const count = api.writes.length;
    assert.throws(() => update(api, id, "rest-1"), /completed journey/);
    assert.equal(api.writes.length, count);
  });
}

test("updates leave other stops and other journeys unchanged", () => {
  const api = harness();
  const first = plan();
  first.waypoints.push({ ...first.waypoints[1], id: "rest-2" });
  const second = {
    ...plan(),
    journeyId: "b8c247b2-f6fa-4316-933e-9920a4620f24",
  };
  api.initializeJourneyPerformance(first, stateCheck());
  api.initializeJourneyPerformance(second, stateCheck());
  const untouched = JSON.stringify(
    api.loadJourneyPerformance(second.journeyId),
  );
  api.startPerformanceRest(first.journeyId, "rest-1");
  api.finishPerformanceRest(first.journeyId, "rest-1", 15);
  api.completePerformanceRestCheck(first.journeyId, "rest-1", afterRestCheck());
  const updated = api.loadJourneyPerformance(first.journeyId);
  assert.equal(updated.rests[1].status, "planned");
  assert.equal(updated.rests[1].actualMinutes, null);
  assert.equal(
    JSON.stringify(api.loadJourneyPerformance(second.journeyId)),
    untouched,
  );
});

test("ambiguous duplicate waypoint records are rejected", () => {
  const api = initializedJourney();
  const id = api.navigation.journeyId;
  const record = api.loadJourneyPerformance(id);
  record.rests.push({ ...record.rests[0] });
  api.saveJourneyPerformance(record);
  assert.throws(
    () => api.startPerformanceRest(id, "rest-1"),
    /exactly one matching/,
  );
});

test("skipped rests cannot be silently restarted", () => {
  const api = initializedJourney();
  const id = api.navigation.journeyId;
  const record = api.loadJourneyPerformance(id);
  record.rests[0].status = "skipped";
  record.rests[0].actualMinutes = 0;
  api.saveJourneyPerformance(record);
  assert.throws(() => api.startPerformanceRest(id, "rest-1"), /skipped rest/);
});

test("a failed update preserves the previously saved record", () => {
  const api = initializedJourney();
  const id = api.navigation.journeyId;
  api.browser.localStorage.setItem = () => {
    throw new Error("Storage blocked");
  };
  assert.throws(
    () => api.startPerformanceRest(id, "rest-1"),
    /Storage blocked/,
  );
  assert.equal(api.loadJourneyPerformance(id).rests[0].status, "planned");
});

const REST_START = Date.parse("2026-10-08T09:00:00Z");
function initializedRestSession() {
  const api = initializedJourney();
  api.browser.localStorage.setItem(
    "currentNavigationPlan",
    JSON.stringify(api.navigation),
  );
  return {
    ...api,
    id: api.navigation.journeyId,
    stop: { id: "rest-1", stopName: "Test Rest Area", requiredRestMins: 15 },
  };
}

test("punch-in writes the timer and planned rest under the same journey", () => {
  const api = initializedRestSession();
  const record = api.punchInAfterRest(api.id, api.stop, REST_START);
  assert.equal(record.journeyId, api.id);
  assert.equal(record.punchInAt, REST_START);
  assert.equal(record.punchOutAt, null);
  assert.equal(
    api.getAfterRestRecordById("rest-1", api.id).punchInAt,
    REST_START,
  );
  assert.equal(api.loadJourneyPerformance(api.id).rests[0].status, "resting");
});

test("repeated punch-in cannot reset the timer", () => {
  const api = initializedRestSession();
  api.punchInAfterRest(api.id, api.stop, REST_START);
  const count = api.writes.length;
  const repeated = api.punchInAfterRest(api.id, api.stop, REST_START + 60000);
  assert.equal(repeated.punchInAt, REST_START);
  assert.equal(api.writes.length, count);
});

test("punch-out records exact partial minutes in both stores", () => {
  const api = initializedRestSession();
  api.punchInAfterRest(api.id, api.stop, REST_START);
  const record = api.punchOutAfterRest(
    api.id,
    "rest-1",
    REST_START + 7.25 * 60000,
  );
  assert.equal(record.actualRestMins, 7.25);
  assert.equal(record.completed, false);
  const scored = api.loadJourneyPerformance(api.id).rests[0];
  assert.equal(scored.actualMinutes, 7.25);
  assert.equal(scored.status, "completed");
  assert.equal(scored.afterRestCheck.completed, null);
});

test("repeated punch-out cannot count time twice", () => {
  const api = initializedRestSession();
  api.punchInAfterRest(api.id, api.stop, REST_START);
  api.punchOutAfterRest(api.id, "rest-1", REST_START + 60000);
  const count = api.writes.length;
  const repeated = api.punchOutAfterRest(api.id, "rest-1", REST_START + 120000);
  assert.equal(repeated.actualRestMins, 1);
  assert.equal(repeated.punchOutAt, REST_START + 60000);
  assert.equal(api.writes.length, count);
});

for (const value of [
  "not_sleepy",
  "slightly_sleepy",
  "very_sleepy",
  "dozing_off",
]) {
  test(`page session saves ${value} for restoration but only completion for scoring`, () => {
    const api = initializedRestSession();
    api.punchInAfterRest(api.id, api.stop, REST_START);
    api.punchOutAfterRest(api.id, "rest-1", REST_START + 15 * 60000);
    const result = api.completeAfterRestSessionCheck(
      api.id,
      "rest-1",
      value,
      REST_START + 16 * 60000,
    );
    assert.equal(result.stateCheck.value, value);
    assert.equal(
      api.getAfterRestRecordById("rest-1", api.id).stateCheck.value,
      value,
    );
    assert.equal(JSON.parse(api.entries.get("currentStateCheck")).value, value);
    const check = api.loadJourneyPerformance(api.id).rests[0].afterRestCheck;
    assert.equal(check.completed, true);
    assert.equal("value" in check, false);
  });
}

test("multiple sessions accumulate once and invalidate the earlier check", () => {
  const api = initializedRestSession();
  api.punchInAfterRest(api.id, api.stop, REST_START);
  api.punchOutAfterRest(api.id, "rest-1", REST_START + 7 * 60000);
  api.completeAfterRestSessionCheck(
    api.id,
    "rest-1",
    "not_sleepy",
    REST_START + 8 * 60000,
  );
  const resumed = api.punchInAfterRest(
    api.id,
    api.stop,
    REST_START + 9 * 60000,
  );
  assert.equal(resumed.actualRestMins, 7);
  assert.equal(resumed.stateCheck, null);
  assert.equal(
    api.loadJourneyPerformance(api.id).rests[0].afterRestCheck,
    null,
  );
  const result = api.punchOutAfterRest(
    api.id,
    "rest-1",
    REST_START + 17.5 * 60000,
  );
  assert.equal(result.actualRestMins, 15.5);
  assert.equal(result.completed, true);
  assert.equal(api.loadJourneyPerformance(api.id).rests[0].actualMinutes, 15.5);
});

test("a fresh journey never reuses a previous journey's matching stop", () => {
  const api = initializedRestSession();
  api.punchInAfterRest(api.id, api.stop, REST_START);
  api.punchOutAfterRest(api.id, "rest-1", REST_START + 15 * 60000);
  const second = {
    ...plan(),
    journeyId: "b8c247b2-f6fa-4316-933e-9920a4620f24",
  };
  api.initializeJourneyPerformance(second, stateCheck());
  api.browser.localStorage.setItem(
    "currentNavigationPlan",
    JSON.stringify(second),
  );
  const record = api.punchInAfterRest(
    second.journeyId,
    api.stop,
    REST_START + 20 * 60000,
  );
  assert.equal(record.actualRestMins, null);
  assert.equal(api.getAfterRestRecordById("rest-1", api.id).actualRestMins, 15);
  assert.equal(api.loadAfterRestRecords().length, 2);
  assert.throws(
    () => api.punchOutAfterRest(api.id, "rest-1", REST_START + 30 * 60000),
    /current navigation/,
  );
});

test("legacy unscoped history is preserved, never reused or silently migrated", () => {
  const api = initializedRestSession();
  const legacy = {
    id: "rest-1",
    stopName: "Old Rest",
    requiredRestMins: 15,
    punchInAt: REST_START - 3600000,
    punchOutAt: REST_START - 2700000,
    actualRestMins: 15,
    completed: true,
  };
  api.entries.set("afterRestRecords", JSON.stringify([legacy]));
  assert.equal(api.getAfterRestRecordById("rest-1", api.id), undefined);
  assert.equal(api.getAfterRestRecordById("rest-1", null), undefined);
  api.punchInAfterRest(api.id, api.stop, REST_START);
  const saved = JSON.parse(api.entries.get("afterRestRecords"));
  assert.deepEqual(saved[0], legacy);
  assert.equal(saved.length, 2);
});

test("plan preview sessions do not touch the active journey performance", () => {
  const api = initializedRestSession();
  const before = JSON.stringify(api.loadJourneyPerformance(api.id));
  api.punchInAfterRest(null, api.stop, REST_START);
  api.punchOutAfterRest(null, "rest-1", REST_START + 60000);
  api.completeAfterRestSessionCheck(
    null,
    "rest-1",
    "not_sleepy",
    REST_START + 120000,
  );
  assert.equal(JSON.stringify(api.loadJourneyPerformance(api.id)), before);
  assert.equal(api.getAfterRestRecordById("rest-1", null).actualRestMins, 1);
  assert.equal(api.getAfterRestRecordById("rest-1", api.id), undefined);
});

test("unplanned rest stops keep the timer and state check without creating a scored obligation", () => {
  const api = initializedRestSession();
  api.navigation.waypoints.push({ id: "urgent-rest", kind: "stop" });
  api.browser.localStorage.setItem(
    "currentNavigationPlan",
    JSON.stringify(api.navigation),
  );
  const before = JSON.stringify(api.loadJourneyPerformance(api.id));
  const stop = {
    id: "urgent-rest",
    stopName: "Extra Rest",
    requiredRestMins: null,
  };
  api.punchInAfterRest(api.id, stop, REST_START);
  api.punchOutAfterRest(api.id, stop.id, REST_START + 60000);
  api.completeAfterRestSessionCheck(
    api.id,
    stop.id,
    "not_sleepy",
    REST_START + 120000,
  );
  assert.equal(JSON.stringify(api.loadJourneyPerformance(api.id)), before);
  assert.equal(
    api.getAfterRestRecordById(stop.id, api.id).stateCheck.value,
    "not_sleepy",
  );
});

test("a backwards clock cannot reduce or fabricate rest time", () => {
  const api = initializedRestSession();
  api.punchInAfterRest(api.id, api.stop, REST_START);
  assert.throws(
    () => api.punchOutAfterRest(api.id, "rest-1", REST_START - 1),
    /Invalid rest end time/,
  );
  assert.equal(api.getAfterRestRecordById("rest-1", api.id).punchOutAt, null);
});

test("an after-rest check cannot precede punch-out", () => {
  const api = initializedRestSession();
  api.punchInAfterRest(api.id, api.stop, REST_START);
  assert.throws(
    () =>
      api.completeAfterRestSessionCheck(
        api.id,
        "rest-1",
        "not_sleepy",
        REST_START + 60000,
      ),
    /Finish the current rest/,
  );
  api.punchOutAfterRest(api.id, "rest-1", REST_START + 60000);
  assert.throws(
    () =>
      api.completeAfterRestSessionCheck(
        api.id,
        "rest-1",
        "not_sleepy",
        REST_START + 59999,
      ),
    /Finish the current rest/,
  );
});

test("a failed timer save restores the performance update", () => {
  const api = initializedRestSession();
  const write = api.browser.localStorage.setItem;
  api.browser.localStorage.setItem = (key, value) => {
    if (key === "afterRestRecords") throw new Error("Timer storage blocked");
    write(key, value);
  };
  assert.throws(
    () => api.punchInAfterRest(api.id, api.stop, REST_START),
    /Timer storage blocked/,
  );
  assert.equal(api.getAfterRestRecordById("rest-1", api.id), undefined);
  assert.equal(api.loadJourneyPerformance(api.id).rests[0].status, "planned");
});

test("a failed global state save restores both the timer and scoring check", () => {
  const api = initializedRestSession();
  api.punchInAfterRest(api.id, api.stop, REST_START);
  api.punchOutAfterRest(api.id, "rest-1", REST_START + 60000);
  const write = api.browser.localStorage.setItem;
  api.browser.localStorage.setItem = (key, value) => {
    if (key === "currentStateCheck") throw new Error("State storage blocked");
    write(key, value);
  };
  assert.throws(
    () =>
      api.completeAfterRestSessionCheck(
        api.id,
        "rest-1",
        "not_sleepy",
        REST_START + 120000,
      ),
    /State storage blocked/,
  );
  assert.equal(api.getAfterRestRecordById("rest-1", api.id).stateCheck, null);
  assert.equal(
    api.loadJourneyPerformance(api.id).rests[0].afterRestCheck.completed,
    null,
  );
});

test("corrupt rest history is not discarded or overwritten", () => {
  const api = initializedRestSession();
  api.entries.set("afterRestRecords", '{"not":"an array"}');
  assert.throws(
    () => api.punchInAfterRest(api.id, api.stop, REST_START),
    /Invalid after-rest history/,
  );
  assert.equal(api.entries.get("afterRestRecords"), '{"not":"an array"}');
  assert.equal(api.loadJourneyPerformance(api.id).rests[0].status, "planned");
});

function summaryRest(overrides = {}) {
  return {
    journeyId: plan().journeyId,
    id: "rest-1",
    stopName: "Test Rest Area",
    requiredRestMins: 15,
    punchInAt: REST_START,
    punchOutAt: REST_START + 15.75 * 60000,
    actualRestMins: 15.75,
    completed: true,
    ...overrides,
  };
}

test("merged summary only counts finished rests from the matching journey", () => {
  const api = harness();
  const summary = api.createJourneySafetySummary(
    plan(),
    { nextWaypointIndex: 3, completedWaypointIds: ["rest-1"], rerouteCount: 2 },
    [
      summaryRest(),
      summaryRest({ journeyId: "another-journey", actualRestMins: 99 }),
      summaryRest({ journeyId: null, actualRestMins: 99 }),
      summaryRest({ journeyId: undefined, actualRestMins: 99 }),
      summaryRest({ punchOutAt: null }),
      summaryRest({ completed: false }),
      summaryRest({ id: "another-stop" }),
      summaryRest({ punchInAt: Date.parse(plan().createdAt) - 1 }),
    ],
  );
  assert.equal(summary.plannedRestStops, 1);
  assert.equal(summary.completedRestStops, 1);
  assert.equal(summary.confirmedRestMinutes, 15.75);
  assert.equal(summary.rerouteCount, 2);
});

test("a legacy summary uses only unscoped records, never preview or scoped rests", () => {
  const api = harness();
  const navigation = plan();
  delete navigation.journeyId;
  const summary = api.createJourneySafetySummary(
    navigation,
    { nextWaypointIndex: 3, completedWaypointIds: ["rest-1"], rerouteCount: 0 },
    [
      summaryRest(),
      summaryRest({ journeyId: null }),
      summaryRest({ journeyId: undefined }),
    ],
  );
  assert.equal(summary.completedRestStops, 1);
  assert.equal(summary.confirmedRestMinutes, 15.75);
});

test("summary storage coexists with raw scoring records without replacing them", () => {
  const api = harness();
  const navigation = plan();
  navigation.waypoints[0].name = "Melbourne";
  navigation.waypoints[2].name = "Bendigo";
  api.initializeJourneyPerformance(navigation, stateCheck());
  const before = JSON.stringify(
    api.loadJourneyPerformance(navigation.journeyId),
  );
  assert.equal(api.loadJourneySafetySummary(), null);
  const summary = api.createJourneySafetySummary(
    navigation,
    { nextWaypointIndex: 3, completedWaypointIds: ["rest-1"], rerouteCount: 0 },
    [summaryRest()],
  );
  api.saveJourneySafetySummary(summary);
  assert.equal(
    JSON.stringify(api.loadJourneySafetySummary()),
    JSON.stringify(summary),
  );
  assert.equal(
    JSON.stringify(api.loadJourneyPerformance(navigation.journeyId)),
    before,
  );
});
