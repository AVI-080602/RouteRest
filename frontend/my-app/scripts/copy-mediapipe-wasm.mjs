/**
 * Copies MediaPipe's vision runtime from node_modules into
 * public/mediapipe/ so the camera check loads it from our own site.
 *
 * Why this exists: the camera check used to fetch this runtime from a
 * public code delivery network at whatever version was newest, while the
 * library calling it is fixed at the version in package.json. The
 * security testing in Iteration 2 recorded that as a finding for three
 * reasons: code we have never reviewed could reach drivers, the runtime
 * could drift out of step with the library, and the camera check stopped
 * working whenever that outside network was unreachable. Serving the
 * runtime ourselves removes all three, and the copy always matches the
 * installed version because it comes from the same package.
 *
 * Runs on postinstall, predev and prebuild (see package.json), next to
 * copy-maplibre-worker.mjs. public/mediapipe/ is gitignored; nothing
 * generated is committed.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = dirname(dirname(fileURLToPath(import.meta.url)));
const wasmDir = join(
  appDir,
  "node_modules",
  "@mediapipe",
  "tasks-vision",
  "wasm",
);
const outDir = join(appDir, "public", "mediapipe");

if (!existsSync(wasmDir)) {
  console.error(
    `[copy-mediapipe-wasm] ${wasmDir} not found, is @mediapipe/tasks-vision installed?`,
  );
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });

// The loader picks one of these at runtime depending on what the device
// supports, so all of them are copied rather than a chosen few.
const files = readdirSync(wasmDir).filter(
  (name) => name.endsWith(".js") || name.endsWith(".wasm"),
);

for (const file of files) {
  copyFileSync(join(wasmDir, file), join(outDir, file));
}

console.log(
  `[copy-mediapipe-wasm] copied ${files.length} runtime files to public/mediapipe/`,
);
