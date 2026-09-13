export type StateCheckContext = "pre-departure" | "after-rest";

export type SelfReportedStateValue =
  "not_sleepy" | "slightly_sleepy" | "very_sleepy" | "dozing_off";

export type StateCheckSource = "Self-report";

export type SelfReportedState = {
  value: SelfReportedStateValue;
  label: string;
  source: StateCheckSource;
  updatedAt: string;
  context: StateCheckContext;
};

export type SelfReportedStateOption = {
  value: SelfReportedStateValue;
  label: string;
};

export const SELF_REPORTED_STATE_OPTIONS: SelfReportedStateOption[] = [
  { value: "not_sleepy", label: "Not Sleepy" },
  { value: "slightly_sleepy", label: "Slightly Sleepy" },
  { value: "very_sleepy", label: "Very Sleepy" },
  { value: "dozing_off", label: "Dozing Off" },
];
