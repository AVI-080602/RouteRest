import { CameraMonitoringPreference } from "@/types/cameraMonitoring";

// Key used to store the camera monitoring preference in localStorage.
export const CAMERA_MONITORING_STORAGE_KEY = "cameraMonitoringPreference";

/**
 * Creates a new CameraMonitoringPreference object with the specified enabled state.
 * @param enabled Whether the camera monitoring is enabled.
 * @returns A new CameraMonitoringPreference object with the specified enabled state.
 */
export function createCameraMonitoringPreference(
  enabled: boolean,
): CameraMonitoringPreference {
  return {
    enabled,
    source: "Camera Monitoring Preference",
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Saves the specified CameraMonitoringPreference object to localStorage.
 * @param preference The CameraMonitoringPreference object to save.
 */
export function saveCameraMonitoringPreference(
  preference: CameraMonitoringPreference,
) {
  // Save the CameraMonitoringPreference object to localStorage.
  localStorage.setItem(
    CAMERA_MONITORING_STORAGE_KEY,
    JSON.stringify(preference),
  );
}

/**
 * Loads the current CameraMonitoringPreference object from localStorage.
 * @returns The current CameraMonitoringPreference object from localStorage, or null if not available or invalid.
 */
export function loadCameraMonitoringPreference(): CameraMonitoringPreference | null {
  const rawPreference = localStorage.getItem(CAMERA_MONITORING_STORAGE_KEY); // Retrieve the raw JSON string from localStorage.

  if (!rawPreference) {
    return null;
  }

  try {
    const parsedPreference = JSON.parse(
      rawPreference,
    ) as Partial<CameraMonitoringPreference>;

    // Validate the parsed CameraMonitoringPreference object.
    if (
      typeof parsedPreference.enabled !== "boolean" ||
      parsedPreference.source !== "Camera Monitoring Preference" ||
      typeof parsedPreference.updatedAt !== "string"
    ) {
      return null;
    }

    return {
      enabled: parsedPreference.enabled,
      source: parsedPreference.source,
      updatedAt: parsedPreference.updatedAt,
    };
  } catch {
    return null;
  }
}
