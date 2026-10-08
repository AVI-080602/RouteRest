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
function harness({
  fetchImpl = async () => {
    throw new Error("Unexpected network request.");
  },
} = {}) {
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
        process: { env: { NEXT_PUBLIC_API_URL: "http://test.invalid" } },
        fetch: fetchImpl,
        AbortController,
        setTimeout,
        clearTimeout,
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
    ...loadModule("utils/journeyRequest.ts"),
    ...loadModule("utils/journeyPerformanceValidation.ts"),
    ...loadModule("utils/journeyPerformanceAPI.ts"),
    ...loadModule("utils/journeyRatingStorage.ts"),
    ...loadModule("utils/journeyRating.ts"),
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

const JOURNEY_END = Date.parse("2026-10-08T11:00:00Z");

function completedJourney() {
  const api = initializedJourney();
  const id = api.navigation.journeyId;
  api.startPerformanceRest(id, "rest-1");
  api.finishPerformanceRest(id, "rest-1", 7.25);
  api.completePerformanceRestCheck(id, "rest-1", afterRestCheck());
  const record = api.completeJourneyPerformance(id, JOURNEY_END);
  return { ...api, record };
}

test("completing a journey saves the end time without changing snapshots", () => {
  const api = initializedJourney();
  const before = api.loadJourneyPerformance(api.navigation.journeyId);
  const record = api.completeJourneyPerformance(
    api.navigation.journeyId,
    JOURNEY_END,
  );
  assert.equal(record.status, "completed");
  assert.equal(record.completedAt, new Date(JOURNEY_END).toISOString());
  assert.equal(JSON.stringify(record.rests), JSON.stringify(before.rests));
  assert.equal(
    JSON.stringify(record.preDepartureCheck),
    JSON.stringify(before.preDepartureCheck),
  );
  assert.equal(record.rests[0].actualMinutes, null);
  assert.equal(record.rests[0].afterRestCheck, null);
});

test("repeated journey completion preserves the timestamp without another write", () => {
  const api = completedJourney();
  const count = api.writes.length;
  const again = api.completeJourneyPerformance(
    api.record.journeyId,
    JOURNEY_END + 60000,
  );
  assert.equal(again.completedAt, api.record.completedAt);
  assert.equal(api.writes.length, count);
});

test("journey completion rejects an unknown journey", () => {
  assert.throws(
    () => harness().completeJourneyPerformance("missing", JOURNEY_END),
    /not been initialized/,
  );
});

test("journey completion rejects an active rest without changing it", () => {
  const api = initializedJourney();
  api.startPerformanceRest(api.navigation.journeyId, "rest-1");
  const count = api.writes.length;
  assert.throws(
    () => api.completeJourneyPerformance(api.navigation.journeyId, JOURNEY_END),
    /active rest/,
  );
  assert.equal(api.writes.length, count);
});

for (const now of [NaN, Infinity, Date.parse("2026-10-08T07:59:00Z")]) {
  test(`journey completion rejects invalid end time ${now}`, () => {
    const api = initializedJourney();
    const count = api.writes.length;
    assert.throws(
      () => api.completeJourneyPerformance(api.navigation.journeyId, now),
      /completion time/,
    );
    assert.equal(api.writes.length, count);
  });
}

test("journey completion propagates save failure and preserves the original", () => {
  const api = initializedJourney();
  api.browser.localStorage.setItem = () => {
    throw new Error("Storage blocked");
  };
  assert.throws(
    () => api.completeJourneyPerformance(api.navigation.journeyId, JOURNEY_END),
    /Storage blocked/,
  );
  assert.equal(
    api.loadJourneyPerformance(api.navigation.journeyId).status,
    "in_progress",
  );
});

test("request maps field names, exact minutes and existing history without mutation", () => {
  const api = completedJourney();
  const before = JSON.stringify(api.record);
  const request = api.buildJourneyPerformanceRequest(api.record, 160, 2);
  assert.equal(
    JSON.stringify(request),
    JSON.stringify({
      journey_id: api.record.journeyId,
      status: "completed",
      rests: [{ required_minutes: 15, actual_minutes: 7.25 }],
      checks: [true, true],
      previous_total: 160,
      previous_count: 2,
    }),
  );
  assert.equal(JSON.stringify(api.record), before);
});

test("first scoring request uses zero history and preserves all unknown data", () => {
  const api = harness();
  const navigation = plan();
  api.initializeJourneyPerformance(navigation, null);
  const record = api.completeJourneyPerformance(
    navigation.journeyId,
    JOURNEY_END,
  );
  const request = api.buildJourneyPerformanceRequest(record, 0, 0);
  assert.equal(request.previous_total, 0);
  assert.equal(request.previous_count, 0);
  assert.equal(request.rests[0].actual_minutes, null);
  assert.equal(JSON.stringify(request.checks), JSON.stringify([null, null]));
});

test("request preserves explicitly incomplete checks rather than replacing false", () => {
  const api = completedJourney();
  api.record.preDepartureCheck = { completed: false, completedAt: null };
  api.record.rests[0].afterRestCheck = { completed: false, completedAt: null };
  assert.equal(
    JSON.stringify(api.buildJourneyPerformanceRequest(api.record, 0, 0).checks),
    JSON.stringify([false, false]),
  );
});

test("request with no planned rests still contains the departure check", () => {
  const api = harness();
  const navigation = plan();
  navigation.waypoints.splice(1, 1);
  api.initializeJourneyPerformance(navigation, stateCheck());
  const record = api.completeJourneyPerformance(
    navigation.journeyId,
    JOURNEY_END,
  );
  const request = api.buildJourneyPerformanceRequest(record, 0, 0);
  assert.equal(request.rests.length, 0);
  assert.equal(JSON.stringify(request.checks), JSON.stringify([true]));
});

test("request rejects an unfinished journey or missing completion time", () => {
  const api = initializedJourney();
  const record = api.loadJourneyPerformance(api.navigation.journeyId);
  assert.throws(
    () => api.buildJourneyPerformanceRequest(record, 0, 0),
    /Complete the journey/,
  );
  record.status = "completed";
  assert.throws(
    () => api.buildJourneyPerformanceRequest(record, 0, 0),
    /Complete the journey/,
  );
});

test("request rejects simulated journeys", () => {
  const api = completedJourney();
  api.record.isSimulation = true;
  assert.throws(
    () => api.buildJourneyPerformanceRequest(api.record, 0, 0),
    /Simulated journeys/,
  );
});

test("request rejects malformed records before creating JSON", () => {
  const api = completedJourney();
  api.record.rests[0].actualMinutes = NaN;
  assert.throws(
    () => api.buildJourneyPerformanceRequest(api.record, 0, 0),
    /Invalid journey performance/,
  );
});

for (const [total, count] of [
  [1, 0],
  [-1, 1],
  [101, 1],
  [NaN, 1],
  [Infinity, 1],
  [0, -1],
  [0, 1.5],
  [0, NaN],
  [0, Number.MAX_SAFE_INTEGER + 1],
  ["100", 1],
  [0, "1"],
]) {
  test(`request rejects invalid history total=${total}, count=${count}`, () => {
    const api = completedJourney();
    assert.throws(
      () => api.buildJourneyPerformanceRequest(api.record, total, count),
      /Invalid previous rating history/,
    );
  });
}

function scoredResponse() {
  return {
    journey_id: plan().journeyId,
    journey: {
      status: "scored",
      scoring_version: "v1",
      journey_score: 100,
      rest_points: 80,
      check_points: 20,
      rest_applicable: true,
    },
    overall: {
      total_score: 100,
      journey_count: 1,
      previous_average: null,
      overall_average: 100,
      change: null,
    },
  };
}

test("response guard accepts first and subsequent ratings", () => {
  const { isJourneyPerformanceResponse: valid } = harness();
  const response = scoredResponse();
  assert.equal(valid(response), true);
  Object.assign(response.overall, {
    total_score: 160,
    journey_count: 2,
    previous_average: 60,
    overall_average: 80,
    change: 20,
  });
  assert.equal(valid(response), true);
});

test("response guard accepts checks-only scoring without rest points", () => {
  const { isJourneyPerformanceResponse: valid } = harness();
  const response = scoredResponse();
  Object.assign(response.journey, {
    rest_applicable: false,
    rest_points: null,
    check_points: 100,
  });
  assert.equal(valid(response), true);
  response.journey.rest_points = 0;
  assert.equal(valid(response), false);
});

test("insufficient data must not carry an overall rating", () => {
  const { isJourneyPerformanceResponse: valid } = harness();
  const response = {
    journey_id: plan().journeyId,
    journey: { status: "insufficient_data", scoring_version: "v1" },
    overall: null,
  };
  assert.equal(valid(response), true);
  response.overall = scoredResponse().overall;
  assert.equal(valid(response), false);
});

for (const [name, mutate] of [
  [
    "empty journey ID",
    (r) => {
      r.journey_id = "";
    },
  ],
  [
    "unsupported version",
    (r) => {
      r.journey.scoring_version = "v2";
    },
  ],
  [
    "unknown status",
    (r) => {
      r.journey.status = "pending";
    },
  ],
  [
    "string score",
    (r) => {
      r.journey.journey_score = "100";
    },
  ],
  [
    "infinite score",
    (r) => {
      r.journey.journey_score = Infinity;
    },
  ],
  [
    "negative score",
    (r) => {
      r.journey.journey_score = -1;
    },
  ],
  [
    "out-of-range rest points",
    (r) => {
      r.journey.rest_points = 81;
    },
  ],
  [
    "out-of-range check points",
    (r) => {
      r.journey.check_points = 21;
    },
  ],
  [
    "missing field",
    (r) => {
      delete r.journey.check_points;
    },
  ],
  [
    "fractional count",
    (r) => {
      r.overall.journey_count = 1.5;
    },
  ],
  [
    "zero count",
    (r) => {
      r.overall.journey_count = 0;
    },
  ],
  [
    "unsafe count",
    (r) => {
      r.overall.journey_count = Number.MAX_SAFE_INTEGER + 1;
    },
  ],
  [
    "previous average for first journey",
    (r) => {
      r.overall.previous_average = 0;
    },
  ],
  [
    "change for first journey",
    (r) => {
      r.overall.change = 0;
    },
  ],
  [
    "total exceeding history",
    (r) => {
      r.overall.total_score = 101;
    },
  ],
  [
    "missing overall",
    (r) => {
      r.overall = null;
    },
  ],
]) {
  test(`response guard rejects ${name}`, () => {
    const response = scoredResponse();
    mutate(response);
    assert.equal(harness().isJourneyPerformanceResponse(response), false);
  });
}

for (const malformed of [null, [], {}, "wrong"]) {
  test(`response guard rejects malformed input ${JSON.stringify(malformed)}`, () => {
    assert.equal(harness().isJourneyPerformanceResponse(malformed), false);
  });
}

test("API sends the request as JSON and forwards cancellation", async () => {
  const request = {
    journey_id: plan().journeyId,
    status: "completed",
    rests: [],
    checks: [true],
    previous_total: 0,
    previous_count: 0,
  };
  const response = scoredResponse();
  const controller = new AbortController();
  const api = harness({
    fetchImpl: async (url, options) => {
      assert.equal(url, "http://test.invalid/journeys/performance/evaluate");
      assert.equal(options.method, "POST");
      assert.equal(options.headers["Content-Type"], "application/json");
      assert.equal(options.body, JSON.stringify(request));
      assert.equal(options.signal, controller.signal);
      return { ok: true, json: async () => response };
    },
  });
  assert.equal(
    await api.evaluateJourneyPerformance(request, controller.signal),
    response,
  );
});

test("API propagates HTTP errors", async () => {
  const api = harness({ fetchImpl: async () => ({ ok: false, status: 422 }) });
  await assert.rejects(api.evaluateJourneyPerformance({}), /HTTP 422/);
});

test("API propagates network and cancellation errors", async () => {
  const error = new DOMException("Request aborted", "AbortError");
  const api = harness({
    fetchImpl: async () => {
      throw error;
    },
  });
  await assert.rejects(
    api.evaluateJourneyPerformance({}),
    (received) => received === error,
  );
});

test("API propagates invalid JSON without inventing a score", async () => {
  const api = harness({
    fetchImpl: async () => ({
      ok: true,
      json: async () => {
        throw new SyntaxError("Invalid JSON");
      },
    }),
  });
  await assert.rejects(api.evaluateJourneyPerformance({}), /Invalid JSON/);
});

test("API returns insufficient data as a normal response", async () => {
  const response = {
    journey_id: plan().journeyId,
    journey: { status: "insufficient_data", scoring_version: "v1" },
    overall: null,
  };
  const api = harness({
    fetchImpl: async () => ({ ok: true, json: async () => response }),
  });
  assert.equal(await api.evaluateJourneyPerformance({}), response);
});

function prepareRatedJourney(api, id = plan().journeyId, minutes = 15) {
  const navigation = { ...plan(), journeyId: id };
  api.initializeJourneyPerformance(navigation, stateCheck());
  api.startPerformanceRest(id, "rest-1");
  api.finishPerformanceRest(id, "rest-1", minutes);
  api.completePerformanceRestCheck(id, "rest-1", afterRestCheck());
  return api.completeJourneyPerformance(id, JOURNEY_END);
}

function ratingReply(request, score = 100) {
  const total = request.previous_total + score;
  const count = request.previous_count + 1;
  const previous = request.previous_count
    ? request.previous_total / request.previous_count
    : null;
  return {
    journey_id: request.journey_id,
    journey: {
      status: "scored",
      scoring_version: "v1",
      journey_score: score,
      rest_points: score - 20,
      check_points: 20,
      rest_applicable: true,
    },
    overall: {
      total_score: total,
      journey_count: count,
      previous_average: previous,
      overall_average: total / count,
      change: previous === null ? null : total / count - previous,
    },
  };
}

test("first journey sets the initial rating and repeated calls never count it twice", async () => {
  let calls = 0;
  const api = harness({
    fetchImpl: async (_, options) => {
      calls++;
      const request = JSON.parse(options.body);
      assert.equal(request.previous_count, 0);
      return { ok: true, json: async () => ratingReply(request) };
    },
  });
  const record = prepareRatedJourney(api);
  const first = api.scoreCompletedJourney(record.journeyId);
  assert.equal(api.scoreCompletedJourney(record.journeyId), first);
  const result = await first;
  assert.equal(result.overall.overall_average, 100);
  assert.equal(result.overall.change, null);
  await api.scoreCompletedJourney(record.journeyId);
  assert.equal(calls, 1);
  assert.equal(api.loadJourneyRatings().length, 1);
  assert.equal(api.loadOverallRating().journey_count, 1);
  assert.equal(
    api.loadJourneyPerformance(record.journeyId).completedAt,
    record.completedAt,
  );
});

test("concurrent journeys are serialized and the second score updates the average", async () => {
  const requests = [];
  const api = harness({
    fetchImpl: async (_, options) => {
      const request = JSON.parse(options.body);
      requests.push(request);
      return {
        ok: true,
        json: async () =>
          ratingReply(request, requests.length === 1 ? 100 : 60),
      };
    },
  });
  const first = prepareRatedJourney(api);
  const second = prepareRatedJourney(
    api,
    "67b08cc0-b6ef-430e-8218-443743490114",
    7.5,
  );
  const [, result] = await Promise.all([
    api.scoreCompletedJourney(first.journeyId),
    api.scoreCompletedJourney(second.journeyId),
  ]);
  assert.equal(requests[1].previous_total, 100);
  assert.equal(requests[1].previous_count, 1);
  assert.equal(result.journey.journey_score, 60);
  assert.equal(result.overall.overall_average, 80);
  assert.equal(result.overall.change, -20);
  assert.equal(api.loadOverallRating().total_score, 160);
  assert.equal(api.loadJourneyRatings().length, 2);
});

test("insufficient data is saved once without affecting cumulative ratings", async () => {
  let calls = 0;
  const api = harness({
    fetchImpl: async (_, options) => {
      calls++;
      const request = JSON.parse(options.body);
      return {
        ok: true,
        json: async () =>
          calls === 1
            ? {
                journey_id: request.journey_id,
                journey: { status: "insufficient_data", scoring_version: "v1" },
                overall: null,
              }
            : ratingReply(request),
      };
    },
  });
  const first = prepareRatedJourney(api);
  const result = await api.scoreCompletedJourney(first.journeyId);
  assert.equal(result.overall, null);
  assert.equal(api.loadOverallRating(), null);
  await api.scoreCompletedJourney(first.journeyId);
  assert.equal(calls, 1);
  const second = prepareRatedJourney(
    api,
    "67b08cc0-b6ef-430e-8218-443743490114",
  );
  await api.scoreCompletedJourney(second.journeyId);
  assert.equal(api.loadOverallRating().journey_count, 1);
});

for (const [name, mutate] of [
  [
    "wrong journey",
    (reply) => {
      reply.journey_id = "another-journey";
    },
  ],
  [
    "malformed response",
    (reply) => {
      reply.journey.journey_score = "100";
    },
  ],
  [
    "inconsistent average",
    (reply) => {
      reply.overall.overall_average = 50;
    },
  ],
  [
    "inconsistent count",
    (reply) => {
      reply.overall.journey_count = 2;
    },
  ],
  [
    "inconsistent breakdown",
    (reply) => {
      reply.journey.rest_points = 40;
    },
  ],
]) {
  test(`rating service rejects ${name} without saving`, async () => {
    const api = harness({
      fetchImpl: async (_, options) => {
        const reply = ratingReply(JSON.parse(options.body));
        mutate(reply);
        return { ok: true, json: async () => reply };
      },
    });
    const record = prepareRatedJourney(api);
    await assert.rejects(api.scoreCompletedJourney(record.journeyId));
    assert.equal(api.loadJourneyRatings().length, 0);
    assert.equal(api.loadOverallRating(), null);
  });
}

test("rating save failure keeps the completed record and allows a successful retry", async () => {
  let calls = 0;
  const api = harness({
    fetchImpl: async (_, options) => {
      calls++;
      return {
        ok: true,
        json: async () => ratingReply(JSON.parse(options.body)),
      };
    },
  });
  const record = prepareRatedJourney(api);
  const setItem = api.browser.localStorage.setItem;
  api.browser.localStorage.setItem = (key, value) => {
    if (key === "journeyRatings:v1") throw new Error("Storage blocked");
    setItem(key, value);
  };
  await assert.rejects(
    api.scoreCompletedJourney(record.journeyId),
    /Storage blocked/,
  );
  assert.equal(api.loadOverallRating(), null);
  assert.equal(
    api.loadJourneyPerformance(record.journeyId).status,
    "completed",
  );
  api.browser.localStorage.setItem = setItem;
  await api.scoreCompletedJourney(record.journeyId);
  assert.equal(calls, 2);
  assert.equal(api.loadOverallRating().journey_count, 1);
});

test("failed network calls can be retried without a stuck in-flight promise", async () => {
  let calls = 0;
  const api = harness({
    fetchImpl: async (_, options) => {
      if (++calls === 1) throw new Error("Network unavailable");
      return {
        ok: true,
        json: async () => ratingReply(JSON.parse(options.body)),
      };
    },
  });
  const record = prepareRatedJourney(api);
  await assert.rejects(
    api.scoreCompletedJourney(record.journeyId),
    /Network unavailable/,
  );
  assert.equal(api.loadJourneyRatings().length, 0);
  await api.scoreCompletedJourney(record.journeyId);
  assert.equal(api.loadOverallRating().journey_count, 1);
});

test("a changed rating history is not overwritten by an older request", async () => {
  let api;
  api = harness({
    fetchImpl: async (_, options) => {
      const request = JSON.parse(options.body);
      api.saveJourneyRating(
        ratingReply({ ...request, journey_id: "other-journey" }),
        0,
        0,
      );
      return { ok: true, json: async () => ratingReply(request) };
    },
  });
  const record = prepareRatedJourney(api);
  await assert.rejects(
    api.scoreCompletedJourney(record.journeyId),
    /history changed/,
  );
  assert.equal(api.loadOverallRating().journey_count, 1);
  assert.equal(api.loadJourneyRating(record.journeyId), null);
});

test("corrupt stored rating history is preserved rather than reset", () => {
  const api = harness();
  api.entries.set("journeyRatings:v1", '{"schemaVersion":1,"results":[null]}');
  const before = api.entries.get("journeyRatings:v1");
  assert.throws(() => api.loadJourneyRatings(), /invalid/);
  assert.throws(() => api.saveJourneyRating(scoredResponse(), 0, 0), /invalid/);
  assert.equal(api.entries.get("journeyRatings:v1"), before);
});

test("duplicate stored journey IDs are rejected", () => {
  const api = harness();
  api.entries.set(
    "journeyRatings:v1",
    JSON.stringify({
      schemaVersion: 1,
      results: [scoredResponse(), scoredResponse()],
    }),
  );
  assert.throws(() => api.loadJourneyRatings(), /invalid/);
});

test("saving a previously rated journey is a no-op", () => {
  const api = harness();
  const result = scoredResponse();
  api.saveJourneyRating(result, 0, 0);
  const count = api.writes.length;
  api.saveJourneyRating(result, 100, 1);
  assert.equal(api.writes.length, count);
  assert.equal(api.loadOverallRating().journey_count, 1);
});

test("starting simulation permanently excludes that journey from real rating calls", async () => {
  const api = harness();
  const navigation = plan();
  api.initializeJourneyPerformance(navigation, stateCheck());
  api.markJourneyPerformanceSimulated(navigation.journeyId);
  const count = api.writes.length;
  api.markJourneyPerformanceSimulated(navigation.journeyId);
  assert.equal(api.writes.length, count);
  api.completeJourneyPerformance(navigation.journeyId, JOURNEY_END);
  assert.equal(
    api.loadJourneyPerformance(navigation.journeyId).isSimulation,
    true,
  );
  await assert.rejects(
    api.scoreCompletedJourney(navigation.journeyId),
    /non-simulated/,
  );
  assert.equal(api.loadJourneyRatings().length, 0);
});

test("completed real journeys cannot be switched to simulation", () => {
  const api = completedJourney();
  assert.throws(
    () => api.markJourneyPerformanceSimulated(api.record.journeyId),
    /completed journey/,
  );
});
