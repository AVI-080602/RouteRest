/**
 * Makes the archived Iteration 1 website ready to be served at
 * routerest.app/iteration1.
 *
 * archive/iteration1/ holds that site as static build output (see its
 * README). This script does two things with it:
 *
 *   1. Copies the files to public/iteration1/, so the scripts, styles,
 *      fonts and the .txt data Next uses for client-side navigation are
 *      served at /iteration1/... like any other public file. The two
 *      placeholders in the build are filled in on the way, from the same
 *      environment variables the main site uses:
 *        __ROUTEREST_ITERATION1_API_URL__      <- NEXT_PUBLIC_API_URL
 *        __ROUTEREST_ITERATION1_MAPTILER_KEY__ <- NEXT_PUBLIC_MAPTILER_KEY
 *      so no key or address is ever committed.
 *
 *   2. Writes the three HTML pages into
 *      app/iteration1/[[...slug]]/pages.generated.ts, which the route
 *      handler next to it returns for /iteration1, /iteration1/newjourney
 *      and /iteration1/route-breaks. The pages are bundled into the server
 *      code this way (rather than read from public/ at request time)
 *      because on Amplify the public files live on the CDN, not beside
 *      the server code.
 *
 * Runs on postinstall, predev and prebuild (see package.json), next to
 * copy-maplibre-worker.mjs. Both outputs are gitignored.
 *
 * Environment variables come from the process first (Amplify sets them
 * for the build), then from .env.local and .env, the same files Next
 * reads, because this script runs before Next has loaded them.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const archiveDir = path.join(appRoot, "archive", "iteration1");
const publicDir = path.join(appRoot, "public", "iteration1");
const pagesModule = path.join(
  appRoot,
  "app",
  "iteration1",
  "[[...slug]]",
  "pages.generated.ts",
);

// Files whose contents may hold a placeholder. Fonts, images and other
// binary files are copied byte for byte.
const TEXT_EXTENSIONS = new Set([
  ".js",
  ".mjs",
  ".css",
  ".html",
  ".txt",
  ".json",
]);

// Kept in the archive for people, not served.
const NOT_SERVED = new Set(["README.md"]);

/** Reads KEY=VALUE lines from an env file, ignoring comments and blanks. */
function readEnvFile(file) {
  if (!existsSync(file)) {
    return {};
  }
  const values = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!match || line.trimStart().startsWith("#")) {
      continue;
    }
    values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  return values;
}

const envFiles = [".env.local", ".env"].map((name) =>
  readEnvFile(path.join(appRoot, name)),
);

function envValue(name, fallback) {
  if (process.env[name]) {
    return process.env[name];
  }
  for (const values of envFiles) {
    if (values[name]) {
      return values[name];
    }
  }
  return fallback;
}

const replacements = [
  // Same default the main site uses when no API address is configured.
  [
    "__ROUTEREST_ITERATION1_API_URL__",
    envValue("NEXT_PUBLIC_API_URL", "http://localhost:8000"),
  ],
  [
    "__ROUTEREST_ITERATION1_MAPTILER_KEY__",
    envValue("NEXT_PUBLIC_MAPTILER_KEY", ""),
  ],
];

function fillPlaceholders(text) {
  let result = text;
  for (const [placeholder, value] of replacements) {
    result = result.split(placeholder).join(value);
  }
  return result;
}

/** Copies one directory tree, filling placeholders in text files. */
function copyTree(from, to) {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    if (NOT_SERVED.has(entry.name)) {
      continue;
    }
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) {
      copyTree(source, target);
    } else if (TEXT_EXTENSIONS.has(path.extname(entry.name))) {
      writeFileSync(target, fillPlaceholders(readFileSync(source, "utf8")));
    } else {
      writeFileSync(target, readFileSync(source));
    }
  }
}

if (!existsSync(archiveDir)) {
  console.warn(
    `[prepare-iteration1] ${archiveDir} not found; /iteration1 will not be served.`,
  );
  process.exit(0);
}

/**
 * Next's client asks for per-segment navigation data with dotted names,
 * for example newjourney/__next.newjourney.__PAGE__.txt, but a build can
 * write the same file as newjourney/__next.newjourney/__PAGE__.txt (a
 * folder where the dot should be; the archive was built on Windows). Both
 * spellings are served, so the archive works whichever system built it.
 * Without this the pages still work, but every prefetch of those files
 * fails with a 404.
 */
function addDottedSegmentNames(dir, relative = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      addDottedSegmentNames(full, [...relative, entry.name]);
      continue;
    }
    const segmentIndex = relative.findIndex((name) =>
      name.startsWith("__next."),
    );
    if (segmentIndex === -1) {
      continue;
    }
    const outerDir = path.join(publicDir, ...relative.slice(0, segmentIndex));
    const dottedName = [...relative.slice(segmentIndex), entry.name].join(".");
    const dottedPath = path.join(outerDir, dottedName);
    if (!existsSync(dottedPath)) {
      writeFileSync(dottedPath, readFileSync(full));
    }
  }
}

// Start from a clean copy so files from an older archive never linger.
rmSync(publicDir, { recursive: true, force: true });
copyTree(archiveDir, publicDir);
addDottedSegmentNames(publicDir);

// Page path (without /iteration1) -> HTML. index.html is the /iteration1
// page itself; 404.html is returned for any other page path.
const pages = {};
for (const entry of readdirSync(archiveDir, { withFileTypes: true })) {
  if (!entry.isFile() || path.extname(entry.name) !== ".html") {
    continue;
  }
  const name = path.basename(entry.name, ".html");
  if (name === "404" || name.startsWith("_")) {
    continue;
  }
  pages[name === "index" ? "" : name] = fillPlaceholders(
    readFileSync(path.join(archiveDir, entry.name), "utf8"),
  );
}
const notFoundFile = path.join(archiveDir, "404.html");
const notFound = existsSync(notFoundFile)
  ? fillPlaceholders(readFileSync(notFoundFile, "utf8"))
  : "<!doctype html><title>Not found</title><h1>Not found</h1>";

mkdirSync(path.dirname(pagesModule), { recursive: true });
writeFileSync(
  pagesModule,
  [
    "// Generated by scripts/prepare-iteration1.mjs from archive/iteration1.",
    "// Do not edit: it is rewritten on every install, dev start and build.",
    "",
    `export const ITERATION1_PAGES: Readonly<Record<string, string>> = ${JSON.stringify(pages)};`,
    "",
    `export const ITERATION1_NOT_FOUND = ${JSON.stringify(notFound)};`,
    "",
  ].join("\n"),
);

const missing = replacements
  .filter(([, value]) => !value)
  .map(([placeholder]) => placeholder);
console.log(
  `[prepare-iteration1] served ${Object.keys(pages).length} pages at /iteration1` +
    (missing.length ? ` (not set, left empty: ${missing.join(", ")})` : ""),
);
