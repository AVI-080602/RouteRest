export type LandmarkPoint = {
  x: number;
  y: number;
  z?: number;
};

export type EyeAnalysis = {
  averageEar: number;
  eyesAreClosed: boolean;
};

const LEFT_EYE_LANDMARKS = [362, 385, 387, 263, 373, 380];
const RIGHT_EYE_LANDMARKS = [33, 160, 158, 133, 153, 144];

export const EAR_THRESHOLD = 0.18;
export const EYE_CLOSED_WARNING_MS = 1500;

/**
 * Calculates the Euclidean distance between two landmark points.
 * @param pointA The first landmark point
 * @param pointB The second landmark point
 * @returns The Euclidean distance between the two points
 */
function getDistance(pointA: LandmarkPoint, pointB: LandmarkPoint) {
  return Math.sqrt((pointA.x - pointB.x) ** 2 + (pointA.y - pointB.y) ** 2);
}

/**
 * Calculates the eye aspect ratio (EAR) for a given set of eye landmarks.
 * @param landmarks The array of all facial landmarks
 * @param eyePoints The indices of the eye landmarks to use for the calculation
 * @returns The eye aspect ratio (EAR) for the specified eye
 */
function calculateEyeAspectRatio(
  landmarks: LandmarkPoint[],
  eyePoints: number[],
) {
  // Map the eyePoints indices to their corresponding landmark points
  const [p1, p2, p3, p4, p5, p6] = eyePoints.map(
    (pointIndex) => landmarks[pointIndex],
  );

  const verticalDistanceOne = getDistance(p2, p6);
  const verticalDistanceTwo = getDistance(p3, p5);
  const horizontalDistance = getDistance(p1, p4);

  return (verticalDistanceOne + verticalDistanceTwo) / (2 * horizontalDistance);
}

// EAR compares eye height with eye width, so lower values mean a more closed eye.
/**
 * Analyzes the eye closure based on the facial landmarks.
 * @param landmarks The array of all facial landmarks
 * @returns An object containing the average EAR and whether the eyes are closed
 */
export function analyzeEyeClosure(landmarks: LandmarkPoint[]): EyeAnalysis {
  const leftEar = calculateEyeAspectRatio(landmarks, LEFT_EYE_LANDMARKS);
  const rightEar = calculateEyeAspectRatio(landmarks, RIGHT_EYE_LANDMARKS);
  const averageEar = (leftEar + rightEar) / 2;

  return {
    averageEar,
    eyesAreClosed: averageEar < EAR_THRESHOLD,
  };
}
