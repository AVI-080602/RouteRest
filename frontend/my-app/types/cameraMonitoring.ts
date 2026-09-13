export type CameraMonitoringPreference = {
  enabled: boolean;
  source: "Camera Monitoring Preference";
  updatedAt: string;
};

export type CameraMonitoringStatus =
  | "not_selected"
  | "inactive"
  | "starting"
  | "active"
  | "permission_denied"
  | "model_error";
