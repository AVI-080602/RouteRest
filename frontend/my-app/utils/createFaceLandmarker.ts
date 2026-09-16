import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

// URL to the Mediapipe WASM files for the vision tasks
const MEDIAPIPE_WASM_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm";

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
