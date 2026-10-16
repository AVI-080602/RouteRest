/**
 * Which voice Rory speaks with (utils/voiceGuidance.ts voiceScore).
 *
 * 17 October 2026: drivers found Rory "very robotic", because the first
 * Australian voice on a device is often its plainest one. Natural-sounding
 * voices must rank first, and robotic or non-English ones last.
 *
 * Run: node --test tests/voiceChoice.test.mjs
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

function load(relativePath) {
  const compiledModule = { exports: {} };
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
  });
  return compiledModule.exports;
}

const { voiceScore } = load("utils/voiceGuidance.ts");
const voice = (name, lang, localService = true) => ({
  name,
  lang,
  localService,
});

const NATASHA = voice(
  "Microsoft Natasha Online (Natural) - English (Australia)",
  "en-AU",
  false,
);
const KAREN = voice("Karen", "en-AU");
const KAREN_ENHANCED = voice("Karen (Enhanced)", "en-AU");
const CATHERINE = voice("Microsoft Catherine - English (Australia)", "en-AU");
const GOOGLE_UK = voice("Google UK English Female", "en-GB", false);
const DAVID = voice("Microsoft David - English (United States)", "en-US");
const ESPEAK = voice("eSpeak English", "en");
const GERMAN = voice("Google Deutsch", "de-DE", false);

const rank = (list) =>
  [...list].sort((a, b) => voiceScore(b) - voiceScore(a)).map((v) => v.name);

test("a natural Australian voice is chosen first", () => {
  assert.equal(
    rank([KAREN, CATHERINE, NATASHA, GOOGLE_UK, DAVID])[0],
    NATASHA.name,
  );
});

test("an enhanced voice beats the plain one of the same accent", () => {
  assert.ok(voiceScore(KAREN_ENHANCED) > voiceScore(KAREN));
});

test("a natural British voice beats a robotic Australian one", () => {
  assert.ok(voiceScore(GOOGLE_UK) > voiceScore(CATHERINE));
});

test("old Windows voices rank below plain modern ones", () => {
  assert.ok(voiceScore(KAREN) > voiceScore(CATHERINE));
  assert.ok(voiceScore(CATHERINE) > voiceScore(DAVID));
});

test("robotic and non-English voices are left out", () => {
  assert.ok(voiceScore(ESPEAK) < 0);
  assert.ok(voiceScore(GERMAN) < 0);
});
