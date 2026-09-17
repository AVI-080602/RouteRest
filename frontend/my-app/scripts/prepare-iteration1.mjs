/**
 * Makes the archived Iteration 1 website ready to be served by this site.
 *
 * Two static builds of that website are kept (see each folder's README):
 *
 *   archive/iteration1       built for routerest.app/iteration1
 *   archive/iteration1-root  built for plain routerest.app, used while
 *                            ROOT_SITE in next.config.ts is "iteration1"
 *
 * For each one this script does two things:
 *
 *   1. Copies the static files to public/<name>/, so the scripts, styles
 *      and fonts are served at /<name>/... like any other public file.
 *      The two placeholders in the builds are filled in on the way, from
 *      the same environment variables the main site uses:
 *        __ROUTEREST_ITERATION1_API_URL__      <- NEXT_PUBLIC_API_URL
 *        __ROUTEREST_ITERATION1_MAPTILER_KEY__ <- NEXT_PUBLIC_MAPTILER_KEY
 *      so no key or address is ever committed.
 *
 *   2. Writes the HTML pages into app/<name>/[[...slug]]/pages.generated.ts,
 *      which the route handler next to it returns. The pages are bundled
 *      into the server code this way (rather than read from public/ at
 *      request time) because on Amplify the public files live on the CDN,
 *      not beside the server code.
 *
 * The root build also bundles its .txt navigation data (the files Next
 * fetches when a link is clicked). A browser asks for those at root
 * addresses such as /newjourney/__next._tree.txt, which next.config.ts
 * rewrites to the route handler, and a rewrite can only reach server code,
 * not a CDN file. The /iteration1 build's data is requested at its real
 * public path, so it stays in public/.
 *
 * Runs on postinstall, predev and prebuild (see package.json), next to
 * copy-maplibre-worker.mjs. All outputs are gitignored.
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

const ARCHIVES = [
  {
    // routerest.app/iteration1/...
    name: "iteration1",
    servedAt: "/iteration1",
    bundleData: false,
  },
  {
    // routerest.app/... while ROOT_SITE is "iteration1".
    name: "iteration1-root",
    servedAt: "/ (while ROOT_SITE is iteration1)",
    bundleData: true,
  },
];

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

/**
 * Every file in a directory tree, as paths relative to it with forward
 * slashes (the form they take in a web address).
 */
function listFiles(dir, relative = "") {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...listFiles(path.join(dir, entry.name), rel));
    } else if (!NOT_SERVED.has(entry.name)) {
      files.push(rel);
    }
  }
  return files;
}

/**
 * Next's client asks for per-segment navigation data with dotted names,
 * for example newjourney/__next.newjourney.__PAGE__.txt, but a build can
 * write the same file as newjourney/__next.newjourney/__PAGE__.txt (a
 * folder where the dot should be; the archives were built on Windows).
 * Returns the dotted spelling, or null when the path has no such folder.
 */
function dottedSegmentName(rel) {
  const parts = rel.split("/");
  const segmentIndex = parts.findIndex(
    (name, i) => i < parts.length - 1 && name.startsWith("__next."),
  );
  if (segmentIndex === -1) {
    return null;
  }
  return [
    ...parts.slice(0, segmentIndex),
    parts.slice(segmentIndex).join("."),
  ].join("/");
}

/** Prepares one archive; returns a line for the summary. */
function prepareArchive({ name, servedAt, bundleData }) {
  const archiveDir = path.join(appRoot, "archive", name);
  const publicDir = path.join(appRoot, "public", name);
  const pagesModule = path.join(
    appRoot,
    "app",
    name,
    "[[...slug]]",
    "pages.generated.ts",
  );

  if (!existsSync(archiveDir)) {
    console.warn(
      `[prepare-iteration1] ${archiveDir} not found; ${servedAt} will not be served.`,
    );
    return null;
  }

  // Start from a clean copy so files from an older archive never linger.
  rmSync(publicDir, { recursive: true, force: true });

  const pages = {};
  const data = {};
  let notFound = "<!doctype html><title>Not found</title><h1>Not found</h1>";

  for (const rel of listFiles(archiveDir)) {
    const source = path.join(archiveDir, ...rel.split("/"));
    const extension = path.extname(rel);
    const isText = TEXT_EXTENSIONS.has(extension);
    const content = isText
      ? fillPlaceholders(readFileSync(source, "utf8"))
      : readFileSync(source);

    // Top-level HTML files are the pages. index.html is the home page;
    // 404.html is returned for any other page path. They are still copied
    // to public/ below, as they always have been.
    if (extension === ".html" && !rel.includes("/")) {
      const page = path.basename(rel, ".html");
      if (page === "404") {
        notFound = content;
      } else if (!page.startsWith("_")) {
        pages[page === "index" ? "" : page] = content;
      }
    }

    const dotted = dottedSegmentName(rel);
    if (bundleData && extension === ".txt") {
      data[rel] = content;
      if (dotted) {
        data[dotted] = content;
      }
      continue;
    }

    const target = path.join(publicDir, ...rel.split("/"));
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
    if (dotted) {
      // Both spellings are served, so the archive works whichever system
      // built it. Without this every prefetch of these files fails.
      writeFileSync(path.join(publicDir, ...dotted.split("/")), content);
    }
  }

  mkdirSync(path.dirname(pagesModule), { recursive: true });
  writeFileSync(
    pagesModule,
    [
      `// Generated by scripts/prepare-iteration1.mjs from archive/${name}.`,
      "// Do not edit: it is rewritten on every install, dev start and build.",
      "",
      "/** Page path (without the leading slash) -> HTML. */",
      `export const PAGES: Readonly<Record<string, string>> = ${JSON.stringify(pages)};`,
      "",
      "/** Navigation data path -> file contents (root build only). */",
      `export const DATA: Readonly<Record<string, string>> = ${JSON.stringify(data)};`,
      "",
      `export const NOT_FOUND = ${JSON.stringify(notFound)};`,
      "",
    ].join("\n"),
  );

  return `${Object.keys(pages).length} pages at ${servedAt}`;
}

const served = ARCHIVES.map(prepareArchive).filter(Boolean);

const missing = replacements
  .filter(([, value]) => !value)
  .map(([placeholder]) => placeholder);
console.log(
  `[prepare-iteration1] served ${served.join(" and ")}` +
    (missing.length ? ` (not set, left empty: ${missing.join(", ")})` : ""),
);
