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
const cache = new Map();
function load(relativePath) {
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
  vm.runInNewContext(code, {
    module: compiledModule,
    exports: compiledModule.exports,
    require(name) {
      assert.ok(name.startsWith("@/"));
      return load(`${name.slice(2)}.ts`);
    },
  });
  return compiledModule.exports;
}
const { getJourneyFeedback } = load("utils/journeyFeedback.ts");

function rest(id, actualMinutes, overrides = {}) {
  return {
    waypointId: id,
    stopName: `Rest stop ${id}`,
    requiredMinutes: 15,
    actualMinutes,
    status: "completed",
    afterRestCheck: null,
    ...overrides,
  };
}
function journey(rests = [rest("one", 15)], overrides = {}) {
  return {
    schemaVersion: 1,
    scoringVersion: "v1",
    journeyId: "trip-a",
    startedAt: "2026-10-12T01:00:00Z",
    completedAt: "2026-10-12T03:00:00Z",
    status: "completed",
    isSimulation: false,
    preDepartureCheck: { completed: null, completedAt: null },
    rests,
    ...overrides,
  };
}

test("one recommendation selects the first short recorded break and includes its evidence", () => {
  const data = journey([rest("one", 20), rest("two", 7.5), rest("three", 5)]);
  const before = JSON.stringify(data);
  const result = getJourneyFeedback("trip-a", data);
  assert.equal(result.kind, "improvement");
  assert.equal(result.evidence.stopName, "Rest stop two");
  assert.equal(result.evidence.plannedMinutes, 15);
  assert.equal(result.evidence.recordedMinutes, 7.5);
  assert.match(result.message, /future similar journeys/);
  assert.equal(
    JSON.stringify(data),
    before,
    "Feedback must not change the completed record",
  );
});

test("all-rest positive feedback requires complete records meeting every planned duration", () => {
  const result = getJourneyFeedback(
    "trip-a",
    journey([rest("one", 15), rest("two", 18)]),
  );
  assert.equal(result.kind, "positive");
  assert.equal(result.partial, false);
  assert.match(result.message, /^All 2 planned rest breaks/);
});

test("partial positive feedback only praises the identified recorded break", () => {
  for (const missing of [
    rest("two", null),
    rest("two", 0, { status: "skipped" }),
    rest("two", null, { status: "planned" }),
    rest("two", 20, { stopName: undefined }),
  ]) {
    const result = getJourneyFeedback(
      "trip-a",
      journey([rest("one", 15), missing]),
    );
    assert.equal(result.kind, "positive");
    assert.equal(result.partial, true);
    assert.equal(result.evidence.stopName, "Rest stop one");
    assert.doesNotMatch(result.message, /All|no fatigue|alert/i);
  }
});

test("a short recorded break is still evaluated when other records are incomplete", () => {
  const result = getJourneyFeedback(
    "trip-a",
    journey([rest("one", null), rest("two", 7)]),
  );
  assert.equal(result.kind, "improvement");
  assert.equal(result.partial, true);
  assert.equal(result.evidence.stopName, "Rest stop two");
});

test("missing journey links, legacy records, duplicates and invalid durations cannot produce feedback", () => {
  for (const data of [
    null,
    journey(undefined, { rests: undefined }),
    journey(undefined, { journeyId: undefined }),
    journey(undefined, { journeyId: "another-trip" }),
    journey([rest("one", 15, { stopName: undefined })]),
    journey([rest("one", 15, { stopName: " " })]),
    journey([rest("one", null)]),
    journey([rest("one", 0, { status: "planned" })]),
    journey([rest("one", 0, { status: "skipped" })]),
    journey([rest("one", 15), rest("one", 15)]),
    journey([rest("one", NaN)]),
    journey([rest("one", -1)]),
    journey([rest("one", 15, { requiredMinutes: 0 })]),
  ]) {
    assert.equal(getJourneyFeedback("trip-a", data).kind, "insufficient_data");
  }
  assert.equal(getJourneyFeedback(null, journey()).kind, "insufficient_data");
});

test("in-progress, simulation and invalid completion timestamps cannot describe real completed behaviour", () => {
  for (const overrides of [
    { status: "in_progress" },
    { isSimulation: true },
    { completedAt: null },
    { completedAt: "invalid" },
    { completedAt: "2026-10-11T00:00:00Z" },
  ]) {
    assert.equal(
      getJourneyFeedback("trip-a", journey(undefined, overrides)).kind,
      "insufficient_data",
    );
  }
});

test("an explicitly empty rest plan is not missing data or positive rest behaviour", () => {
  const result = getJourneyFeedback("trip-a", journey([]));
  assert.equal(result.kind, "no_planned_rests");
  assert.match(result.message, /No rest breaks were planned/);
  assert.match(result.message, /not applicable/);
  assert.equal("evidence" in result, false);
  assert.equal("score" in result, false);
  for (const overrides of [
    { journeyId: "another-trip" },
    { status: "in_progress" },
    { isSimulation: true },
    { completedAt: null },
  ]) {
    assert.equal(
      getJourneyFeedback("trip-a", journey([], overrides)).kind,
      "insufficient_data",
    );
  }
  assert.equal(getJourneyFeedback(null, journey([])).kind, "insufficient_data");
  assert.equal(
    getJourneyFeedback("trip-a", journey([rest("one", null)])).kind,
    "insufficient_data",
  );
});

test("recorded zero and exact fractions use the recorded comparison, without rounding or scores", () => {
  for (const actual of [0, 14.999999]) {
    const result = getJourneyFeedback("trip-a", journey([rest("one", actual)]));
    assert.equal(result.kind, "improvement");
    assert.equal(result.evidence.recordedMinutes, actual);
    assert.equal("score" in result, false);
  }
  assert.equal(
    getJourneyFeedback("trip-a", journey([rest("one", 15)])).kind,
    "positive",
  );
});

test("new journey records snapshot the stop name before navigation is cleared", () => {
  const { createJourneyPerformanceRecord } = load(
    "utils/journeyPerformance.ts",
  );
  const record = createJourneyPerformanceRecord(
    {
      journeyId: "trip-a",
      createdAt: "2026-10-12T01:00:00Z",
      waypoints: [
        {
          id: "one",
          kind: "stop",
          name: "  Calder Woodburn Rest Area  ",
          restBreak: {
            start: "2026-10-12T02:00:00Z",
            end: "2026-10-12T02:15:00Z",
          },
        },
      ],
    },
    null,
  );
  assert.equal(record.rests[0].stopName, "Calder Woodburn Rest Area");
  assert.equal(record.rests[0].requiredMinutes, 15);
  assert.equal(record.rests[0].actualMinutes, null);
});
