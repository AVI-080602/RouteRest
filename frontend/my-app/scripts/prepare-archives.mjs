/**
 * Makes the archived websites ready to be served by this site.
 *
 * Each finished iteration is kept as static build output, so its website
 * stays exactly as it was presented while development carries on. Two
 * builds are kept per iteration (see each folder's README):
 *
 *   archive/iteration1       built for routerest.app/iteration1
 *   archive/iteration1-root  built for plain routerest.app
 *   archive/iteration2       built for routerest.app/iteration2
 *   archive/iteration2-root  built for plain routerest.app
 *
 * The "-root" build is the one used while ROOT_SITE in next.config.ts
 * names that iteration. Only one of them is ever served at a time.
 *
 * For each archive this script does two things:
 *
 *   1. Copies the static files to public/<name>/, so the scripts, styles
 *      and fonts are served at /<name>/... like any other public file.
 *      The two placeholders in the builds are filled in on the way, from
 *      the same environment variables the main site uses:
 *        __ROUTEREST_ITERATION<n>_API_URL__      <- NEXT_PUBLIC_API_URL
 *        __ROUTEREST_ITERATION<n>_MAPTILER_KEY__ <- NEXT_PUBLIC_MAPTILER_KEY
 *      so no key or address is ever committed.
 *
 *   2. Writes the HTML pages into app/<name>/[[...slug]]/pages.generated.ts,
 *      which the route handler next to it returns. The pages are bundled
 *      into the server code this way (rather than read from public/ at
 *      request time) because on Amplify the public files live on the CDN,
 *      not beside the server code.
 *
 * A root build also bundles its .txt navigation data (the files Next
 * fetches when a link is clicked). A browser asks for those at root
 * addresses such as /newjourney/__next._tree.txt, which next.config.ts
 * rewrites to the route handler, and a rewrite can only reach server code,
 * not a CDN file. A build made for /iterationN asks for its data at that
 * build's own public path, so it stays in public/.
 *
 * An archive holds no copy of /models or /maplibre. Those are requested
 * at the site root by address, not through the build's own prefix, so an
 * archived copy would never be fetched; every iteration uses the live
 * site's files at public/models and public/maplibre.
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
  {
    // routerest.app/iteration2/...
    name: "iteration2",
    servedAt: "/iteration2",
    bundleData: false,
  },
  {
    // routerest.app/... while ROOT_SITE is "iteration2".
    name: "iteration2-root",
    servedAt: "/ (while ROOT_SITE is iteration2)",
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

/**
 * The placeholders an archive build writes in place of the two values
 * that must never be committed. The iteration number in the name is
 * matched rather than listed, so archiving a new iteration needs no
 * change here.
 */
const replacements = [
  [
    /__ROUTEREST_ITERATION\d+_API_URL__/g,
    // Same default the main site uses when no API address is configured.
    envValue("NEXT_PUBLIC_API_URL", "http://localhost:8000"),
    "NEXT_PUBLIC_API_URL",
  ],
  [
    /__ROUTEREST_ITERATION\d+_MAPTILER_KEY__/g,
    envValue("NEXT_PUBLIC_MAPTILER_KEY", ""),
    "NEXT_PUBLIC_MAPTILER_KEY",
  ],
];

function fillPlaceholders(text) {
  let result = text;
  for (const [pattern, value] of replacements) {
    // A function replacer, so a "$" in a key is never read as a group.
    result = result.replace(pattern, () => value);
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

const EMPTY_NOT_FOUND =
  "<!doctype html><title>Not found</title><h1>Not found</h1>";

/** Writes the module the route handler beside the archive imports. */
function writePagesModule(file, name, pages, data, notFound) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(
    file,
    [
      `// Generated by scripts/prepare-archives.mjs from archive/${name}.`,
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
    // Still write the module, so the route handler beside it compiles and
    // the site builds. Without it a missing archive breaks the whole
    // build rather than just that one address, which matters while an
    // iteration is being archived and the folder is not filled in yet.
    writePagesModule(pagesModule, name, {}, {}, EMPTY_NOT_FOUND);
    console.warn(
      `[prepare-archives] ${archiveDir} not found; ${servedAt} will answer 404.`,
    );
    return null;
  }

  // Start from a clean copy so files from an older archive never linger.
  rmSync(publicDir, { recursive: true, force: true });

  const pages = {};
  const data = {};
  let notFound = EMPTY_NOT_FOUND;

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

  writePagesModule(pagesModule, name, pages, data, notFound);

  return `${Object.keys(pages).length} pages at ${servedAt}`;
}

const served = ARCHIVES.map(prepareArchive).filter(Boolean);

const missing = replacements
  .filter(([, value]) => !value)
  .map(([, , name]) => name);
console.log(
  `[prepare-archives] served ${served.join(", ")}` +
    (missing.length ? ` (not set, left empty: ${missing.join(", ")})` : ""),
);
