/**
 * Reading the driver's saved progress (utils/navigationProgress.ts).
 *
 * The case that broke on 12 Oct 2026: a journey that has just started has
 * no saved progress, and the rest stop card refused to add a stop. Every
 * page must read "nothing saved" as "heading for the first stop".
 *
 * Run: node --test tests/navigationProgress.test.mjs
 */
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

// A stand-in for the phone's localStorage, shared with the loaded code.
const stored = new Map();
const localStorage = {
  getItem: (key) => (stored.has(key) ? stored.get(key) : null),
  setItem: (key, value) => stored.set(key, String(value)),
};

/** Transpiles a TypeScript file and runs it, resolving "@/" imports. */
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
    localStorage,
    require(name) {
      assert.ok(name.startsWith("@/"));
      return load(`${name.slice(2)}.ts`);
    },
  });
  return compiledModule.exports;
}

const { readNavigationProgress } = load("utils/navigationProgress.ts");
const { NAVIGATION_PROGRESS_STORAGE_KEY } = load("types/navigation.ts");
const FRESH = {
  nextWaypointIndex: 1,
  completedWaypointIds: [],
  rerouteCount: 0,
};

// The vm returns objects from another realm, so compare plain copies.
const read = () => JSON.parse(JSON.stringify(readNavigationProgress()));

test("a journey that has just started reads as heading for the first stop", () => {
  stored.clear();
  assert.deepEqual(read(), FRESH);
});

test("saved progress is returned as saved", () => {
  const saved = {
    nextWaypointIndex: 3,
    completedWaypointIds: ["a", "b"],
    rerouteCount: 1,
  };
  stored.set(NAVIGATION_PROGRESS_STORAGE_KEY, JSON.stringify(saved));
  assert.deepEqual(read(), saved);
});

test("unreadable or malformed progress falls back to the start", () => {
  for (const raw of [
    "not json",
    "null",
    JSON.stringify({
      nextWaypointIndex: "2",
      completedWaypointIds: [],
      rerouteCount: 0,
    }),
    JSON.stringify({
      nextWaypointIndex: 2,
      completedWaypointIds: [1],
      rerouteCount: 0,
    }),
    JSON.stringify({
      nextWaypointIndex: -1,
      completedWaypointIds: [],
      rerouteCount: 0,
    }),
    JSON.stringify({ nextWaypointIndex: 2, completedWaypointIds: [] }),
  ]) {
    stored.set(NAVIGATION_PROGRESS_STORAGE_KEY, raw);
    assert.deepEqual(read(), FRESH, raw);
  }
});
