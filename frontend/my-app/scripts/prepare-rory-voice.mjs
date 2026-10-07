/**
 * Fetches Rory's speech engine into public/rory/engine/ so the navigation
 * page can understand "Hey Rory" without sending any audio off the phone.
 *
 * What it fetches: sherpa-onnx's own published WebAssembly build, version
 * 1.12.0, "vad-asr-en-zipformer_gigaspeech". It is two things in one
 * package: a voice activity detector (Silero VAD), which notices when
 * someone starts and stops speaking, and an English speech recogniser
 * (a zipformer trained on GigaSpeech, quantised to 8 bits), which turns
 * each spoken sentence into text. Both run inside the browser.
 *
 * Why this package and not something newer or smaller (tested on
 * 7 October 2026, details in the pull request):
 * - The newer 1.13.8 browser build, compiled from source, lost the first
 *   two seconds of every utterance and its wake-word spotter crashed on
 *   its first decode, so it could not hear "Hey Rory" at all.
 * - The small English model is a third of the size, but it was trained on
 *   clean read speech and started mishearing questions once engine-like
 *   rumble as loud as the voice was mixed in. This one transcribed every
 *   test question correctly in the same noise, and mishearing in a noisy
 *   cab is risk R12 on the risk register.
 *
 * Why it is downloaded here rather than committed: the package is about
 * 83 MB unpacked, and git is the wrong place for it. Why it is checked:
 * the file is pinned by its SHA-256 fingerprint, so a changed or tampered
 * download is refused rather than shipped to drivers (the same reasoning
 * that moved the camera runtime onto our own site in Iteration 2).
 *
 * Runs on postinstall, predev and prebuild (see package.json). If the
 * download fails the build still succeeds and Rory reports itself as
 * unavailable on the navigation page; everything else works as before.
 * public/rory/engine/ is gitignored.
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const VERSION = "1.12.0";
const PACKAGE = `sherpa-onnx-wasm-simd-${VERSION}-vad-asr-en-zipformer_gigaspeech`;
const URL = `https://github.com/k2-fsa/sherpa-onnx/releases/download/v${VERSION}/${PACKAGE}.tar.bz2`;
const SHA256 =
  "e5bba9e6c4db6485a3543d351bc1b02c7b83aaebee3a0a26af4083f3bb70a724";

// Everything the worker needs. The package's demo page and app script
// are left out: public/rory/rory-worker.js replaces them.
const FILES = [
  "sherpa-onnx-wasm-main-vad-asr.js",
  "sherpa-onnx-wasm-main-vad-asr.wasm",
  "sherpa-onnx-wasm-main-vad-asr.data",
  "sherpa-onnx-vad.js",
  "sherpa-onnx-asr.js",
];

const appDir = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(appDir, "public", "rory", "engine");
const stampFile = join(outDir, "VERSION");

function alreadyPrepared() {
  return (
    existsSync(stampFile) &&
    readFileSync(stampFile, "utf8").trim() === SHA256 &&
    FILES.every((file) => existsSync(join(outDir, file)))
  );
}

/**
 * Unpacks package.tar.bz2 inside `work`. Tries the system tar first, then
 * Python's tarfile, which reads bzip2 by itself: a build image without the
 * bzip2 program (possible on a minimal Amplify image) would otherwise
 * leave Rory silently unavailable in production.
 */
function unpack(work) {
  const attempts = [
    ["tar", ["-xjf", "package.tar.bz2"]],
    [
      "python3",
      ["-c", "import tarfile; tarfile.open('package.tar.bz2').extractall('.')"],
    ],
    [
      "python",
      ["-c", "import tarfile; tarfile.open('package.tar.bz2').extractall('.')"],
    ],
  ];
  for (const [command, args] of attempts) {
    const result = spawnSync(command, args, { cwd: work, stdio: "ignore" });
    if (result.status === 0 && existsSync(join(work, PACKAGE, FILES[0]))) {
      return true;
    }
  }
  return false;
}

async function main() {
  if (alreadyPrepared()) {
    console.log(
      `[prepare-rory-voice] engine ${VERSION} already in public/rory/engine/`,
    );
    return;
  }

  const work = mkdtempSync(join(tmpdir(), "rory-voice-"));
  try {
    console.log(`[prepare-rory-voice] downloading ${PACKAGE} (about 60 MB)`);
    const response = await fetch(URL);
    if (!response.ok) {
      throw new Error(`download failed: HTTP ${response.status}`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());

    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== SHA256) {
      throw new Error(
        `fingerprint mismatch: expected ${SHA256}, got ${digest}. Refusing to use it.`,
      );
    }

    writeFileSync(join(work, "package.tar.bz2"), bytes);
    // Node has no bzip2 of its own; see unpack() above. Both routes run
    // inside the work folder with a bare file name because GNU tar (Git
    // Bash on Windows) reads the "C:" of a full path as a remote host.
    if (!unpack(work)) {
      throw new Error(
        "could not unpack the package (needs tar with bzip2, or Python 3)",
      );
    }

    mkdirSync(outDir, { recursive: true });
    for (const file of FILES) {
      copyFileSync(join(work, PACKAGE, file), join(outDir, file));
    }
    writeFileSync(stampFile, `${SHA256}\n`);
    console.log(
      `[prepare-rory-voice] engine ${VERSION} verified and copied to public/rory/engine/`,
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

main().catch((error) => {
  // Deliberately not a failed build: the rest of the app must still ship.
  // The navigation page tells the driver Rory is unavailable.
  console.warn(
    `[prepare-rory-voice] WARNING: Rory's speech engine is not available: ${error.message}`,
  );
});
