import {
  SELF_REPORTED_STATE_OPTIONS,
  SelfReportedState,
  SelfReportedStateValue,
  StateCheckContext,
} from "@/types/stateCheck";

// Key used to store the current state check result in localStorage.
export const STATE_CHECK_STORAGE_KEY = "currentStateCheck";

/**
 * Checks if a given string value is a valid SelfReportedStateValue.
 * @param value The value to check
 * @returns True if the value is a valid SelfReportedStateValue, false otherwise
 */
export function isSelfReportedStateValue(
  value: string,
): value is SelfReportedStateValue {
  return SELF_REPORTED_STATE_OPTIONS.some((option) => option.value === value);
}

/**
 * Creates a new self-reported state object based on the given value and context.
 * @param value The self-reported state value
 * @param context The context in which the state check is being performed
 * @returns A new SelfReportedState object representing the user's selection
 */
  export function createSelfReportedState(
    value: SelfReportedStateValue,
    context: StateCheckContext,
  ): SelfReportedState {

    // Find the corresponding option object for the given value.
    const option = SELF_REPORTED_STATE_OPTIONS.find(
      (stateOption) => stateOption.value === value,
    );
    
    // If no matching option is found, throw an error.
    if (!option) {
      throw new Error("Unknown self-reported state.");
    }

    return {
      value,
      label: option.label,
      source: "Self-report",
      updatedAt: new Date().toISOString(),
      context,
    };
  }

/**
 * Saves the given self-reported state object to localStorage.
 * @param result The self-reported state object to be saved in localStorage
 */
export function saveStateCheckResult(result: SelfReportedState) {
  localStorage.setItem(STATE_CHECK_STORAGE_KEY, JSON.stringify(result));
}

/**
 * Loads the current self-reported state from localStorage.
 * @returns The current self-reported state from localStorage, or null if not available or invalid.
 */
export function loadStateCheckResult(): SelfReportedState | null {
  const rawResult = localStorage.getItem(STATE_CHECK_STORAGE_KEY); // Retrieve the raw JSON string from localStorage.

  if (!rawResult) {
    return null;
  }

  try {
    // Parse the raw JSON string into a partial SelfReportedState object.
    const parsedResult = JSON.parse(rawResult) as Partial<SelfReportedState>;
    
    // Validate the parsed result to ensure it has the expected structure and values.
    if (
      typeof parsedResult.value !== "string" ||
      !isSelfReportedStateValue(parsedResult.value) ||
      parsedResult.source !== "Self-report" ||
      typeof parsedResult.updatedAt !== "string" ||
      (parsedResult.context !== "pre-departure" &&
        parsedResult.context !== "after-rest")
    ) {
      return null;
    }

    // Construct and return a fully validated SelfReportedState object.
    return {
      value: parsedResult.value,
      label:
        SELF_REPORTED_STATE_OPTIONS.find(
          (option) => option.value === parsedResult.value,
        )?.label ?? parsedResult.value,
      source: parsedResult.source,
      updatedAt: parsedResult.updatedAt,
      context: parsedResult.context,
    };
  } catch {
    return null;
  }
}
