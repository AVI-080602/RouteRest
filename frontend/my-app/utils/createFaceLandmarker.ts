import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

// Where the Mediapipe vision runtime is served from. Our own site, not a
// public code delivery network: scripts/copy-mediapipe-wasm.mjs copies it
// out of the installed package on every install and build, so it always
// matches the library version in package.json, cannot change without a
// deployment, and the camera check keeps working when an outside network
// does not (Iteration 2 security finding).
const MEDIAPIPE_WASM_URL = "/mediapipe";

const FACE_LANDMARKER_MODEL_PATH = "/models/face_landmarker.task";

/**
 * Creates and initializes a FaceLandmarker instance using the Mediapipe vision tasks.
 * @returns A promise that resolves to a FaceLandmarker instance.
 */
export async function createFaceLandmarker() {
  const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_URL);

  return FaceLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: FACE_LANDMARKER_MODEL_PATH,
    },
    runningMode: "VIDEO",
    numFaces: 1,
  });
}
