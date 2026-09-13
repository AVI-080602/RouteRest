"use client";

import { ChevronDown, GripVertical, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useRef } from "react";
import {
  JourneyDetails,
  JourneyDetailsError,
  Destination,
  RestBreak,
} from "@/types/journeyDetails";
import { DragDropProvider } from "@dnd-kit/react";
import { useSortable } from "@dnd-kit/react/sortable";
import { move } from "@dnd-kit/helpers";
import FieldError from "@/components/FieldError";
import Disclaimer from "@/components/Disclaimer";
import { shortenLocationLabel } from "@/utils/locationLabel";
import {
  HELPER_CLASS,
  INPUT_CLASS,
  LABEL_CLASS,
  PANEL_CLASS,
  PRIMARY_BUTTON_CLASS,
  READONLY_FIELD_CLASS,
  SELECT_CLASS,
} from "@/utils/ui";

// Keep the storage key in one place so US 1.3 can read the same draft later.
const LOCAL_STORAGE_KEY = "currentJourneyDetails";
const REST_PLAN_STORAGE_KEY = "currentRestPlan";

// Falls back to localhost for local development; overridable via an env
// var so this does not need editing when the backend is deployed elsewhere.
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// Shared date/time formatting for the rest plan display: no seconds (a
// driver never needs second-level precision for a break time), and a
// weekday so a multi-day plan is readable without doing date arithmetic
// in your head.
const BREAK_TIME_FORMAT = new Intl.DateTimeFormat("en-AU", {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
});

type GeocodeSuggestion = {
  label: string;
  coordinate: {
    lat: number;
    lng: number;
  };
  state: string | null;
};

// The NHVR Standard Hours numbers are verified (this session, against the
// live seeded fatigue_rule table) to be byte-for-byte identical across
// every one of these six states, the Heavy Vehicle National Law is one
// national rule set, not state-by-state legislation. So which exact one
// of these six is selected does not change the computed rest plan at
// all. WA is NOT in this map on purpose, it runs its own separate,
// genuinely different scheme (see WA_STATE_NAME below); NT is not here
// either, it is folded in as its own case in the jurisdiction-
// determination effect (borrowed HVNL numbers, but that borrowing is a
// deliberate app-level default, not the same "identical everywhere"
// fact this map documents for the six real HVNL states).
const STATE_TO_JURISDICTION: Record<string, string> = {
  Victoria: "VIC",
  "New South Wales": "NSW",
  Queensland: "QLD",
  "South Australia": "SA",
  Tasmania: "TAS",
  "Australian Capital Territory": "ACT",
};

const WA_STATE_NAME = "Western Australia";
const NT_STATE_NAME = "Northern Territory";

// The form collects the vehicle's remaining range in kilometres (the
// label says so), so the cap is a sanity limit on kilometres, not a fuel
// tank size. 5,000 km comfortably exceeds any heavy vehicle's real range.
const MAX_REMAINING_RANGE_KM = 5000;

/** True for the one major (7h solo / 5h two-up) daily rest, false for the
 * short 15/30/60-minute breaks. The backend's reason text is the only
 * signal available here; see rest_plan.py, every major-rest reason
 * always contains this phrase. */
const isMajorRest = (reason: string) =>
  reason.toLowerCase().includes("major rest");

/** Turns a whole number of minutes into a plain duration a driver can
 * read at a glance ("15 min", "1 hr 30 min", "7 hr") instead of doing
 * the division themselves. */
const formatDurationMinutes = (totalMinutes: number) => {
  const rounded = Math.round(totalMinutes);
  const hours = Math.floor(rounded / 60);
  const minutes = rounded % 60;
  if (hours === 0) return `${minutes} min`;
  if (minutes === 0) return `${hours} hr`;
  return `${hours} hr ${minutes} min`;
};

/** Turns a start/end pair into the same plain duration format. */
const formatBreakDuration = (start: string, end: string) =>
  formatDurationMinutes(
    (new Date(end).getTime() - new Date(start).getTime()) / 60000,
  );

const EMPTY_ERRORS: JourneyDetailsError = {
  departureLocation: "",
  destination: "",
  vehicleType: "",
  fuelType: "",
  fuelLevel: "",
  departureDate: "",
  departureTime: "",
  arrivalDate: "",
  arrivalTime: "",
  dateTimeRange: "",
  jurisdictionCode: "",
  estimatedDrivingHours: "",
};

/**
 * Every validation rule for the form, as one pure function of the current
 * values. The previous design had eight separate validators that each
 * wrote into error state, and they were only ever called from submit, so
 * a red message stayed on screen after the driver fixed the field until
 * they pressed Start Journey again (BA item 5). Deriving the errors from
 * the values on every render (see the useMemo in the component) means a
 * message disappears the instant its cause does, including the two cases
 * that were hardest to get right by hand: the date-range check, which
 * must recompute when any of four fields changes, and the auto-derived
 * jurisdiction / driving-hours fields, whose values are filled in by
 * effects rather than typed.
 *
 * `pendingDestinationText` is whatever is currently typed in the
 * destination search box. Text that was never picked from a suggestion
 * has no coordinate and cannot be routed, so it is rejected explicitly
 * rather than silently dropped or silently accepted.
 */
function computeJourneyErrors(
  details: JourneyDetails,
  pendingDestinationText: string,
): JourneyDetailsError {
  const errors: JourneyDetailsError = { ...EMPTY_ERRORS };

  if (!details.departureLocation.trim()) {
    errors.departureLocation = "Departure location is required.";
  } else if (!details.departureCoordinate) {
    errors.departureLocation =
      "Pick your departure from the suggestions so it can be located.";
  }

  const pendingDestination = pendingDestinationText.trim();
  if (pendingDestination) {
    errors.destination = `Pick "${shortenLocationLabel(pendingDestination)}" from the suggestions to add it, or clear the field.`;
  } else if (details.destination.length === 0) {
    errors.destination =
      "Add at least one destination by picking a suggestion.";
  }

  if (!details.vehicleType) {
    errors.vehicleType = "Vehicle type is required.";
  }

  if (!details.fuelType) {
    errors.fuelType = "Fuel type is required.";
  }

  const remainingRange = details.fuelLevel.trim();
  if (!remainingRange) {
    errors.fuelLevel = "Remaining range is required.";
  } else if (!/^\d+$/.test(remainingRange)) {
    errors.fuelLevel = "Remaining range must be a whole number of kilometres.";
  } else if (parseInt(remainingRange, 10) > MAX_REMAINING_RANGE_KM) {
    errors.fuelLevel = `Remaining range cannot exceed ${MAX_REMAINING_RANGE_KM.toLocaleString()} km.`;
  }

  // Both of these are computed by effects from picked geocode suggestions,
  // never typed, so the only way they can be missing is a location that
  // was typed as free text rather than picked. The message says so.
  if (!details.jurisdictionCode) {
    errors.jurisdictionCode =
      "Determined once your departure and destinations are picked from the suggestions.";
  }

  if (!details.estimatedDrivingHours.trim()) {
    errors.estimatedDrivingHours =
      "Calculated once your departure and destinations are picked from the suggestions.";
  }

  if (!details.departureDate) {
    errors.departureDate = "Departure date is required.";
  }
  if (!details.departureTime) {
    errors.departureTime = "Departure time is required.";
  }
  if (!details.arrivalDate) {
    errors.arrivalDate = "Target arrival date is required.";
  }
  if (!details.arrivalTime) {
    errors.arrivalTime = "Target arrival time is required.";
  }

  if (
    details.departureDate &&
    details.departureTime &&
    details.arrivalDate &&
    details.arrivalTime
  ) {
    // Only compare the full date-time range after all four fields exist.
    const departureDateTime = new Date(
      `${details.departureDate}T${details.departureTime}`,
    );
    const arrivalDateTime = new Date(
      `${details.arrivalDate}T${details.arrivalTime}`,
    );

    if (departureDateTime >= arrivalDateTime) {
      errors.dateTimeRange = "Departure must be before your target arrival.";
    }
  }

  return errors;
}

const hasAnyError = (errors: JourneyDetailsError) =>
  Object.values(errors).some((message) => message !== "");

export default function NewJourneyPage() {
  const router = useRouter();

  // MVP-only option lists. Vehicle and fuel data can move to an API later.
  const vehicleTypes: string[] = [
    "B-Double",
    "Rigid Truck",
    "Prime Mover",
    "Road Train",
  ];

  const fuelTypes: string[] = ["Diesel", "Electric"];

  // The six HVNL states plus WA (its own separate scheme) and NT
  // (borrowed HVNL default, see backend/db/seed_fatigue_rules_wa_nt.sql
  // for both), matching every jurisdiction_code the backend now has
  // seeded rules for.
  const jurisdictionOptions: { code: string; name: string }[] = [
    { code: "VIC", name: "Victoria" },
    { code: "NSW", name: "New South Wales" },
    { code: "QLD", name: "Queensland" },
    { code: "SA", name: "South Australia" },
    { code: "TAS", name: "Tasmania" },
    { code: "ACT", name: "Australian Capital Territory" },
    { code: "WA", name: "Western Australia" },
    { code: "NT", name: "Northern Territory" },
  ];

  // The destination search box. It is only ever a search field: picking
  // a suggestion adds that place straight to journeyDetails.destination
  // and clears this text (BA item 4, the separate "Confirm Destination"
  // step confused testers who assumed their pick had already been taken).
  const [destinationInput, setDestinationInput] = useState<string>("");
  const [departureSuggestions, setDepartureSuggestions] = useState<
    GeocodeSuggestion[]
  >([]);
  const [destinationSuggestions, setDestinationSuggestions] = useState<
    GeocodeSuggestion[]
  >([]);
  const [isSearchingDeparture, setIsSearchingDeparture] = useState(false);
  const [isSearchingDestination, setIsSearchingDestination] = useState(false);
  // Kept separate (rather than one shared error) so a departure-search
  // failure is not shown under the destination field, or vice versa.
  const [departureGeocodingError, setDepartureGeocodingError] = useState("");
  const [destinationGeocodingError, setDestinationGeocodingError] =
    useState("");
  // Set to true right when a suggestion is clicked, which programmatically
  // sets the field text and would otherwise immediately re-trigger the
  // debounced search effect below (since it depends on that same text),
  // reopening the dropdown the user just closed. Each search effect
  // checks and resets its own flag, so only that one auto-triggered
  // search is skipped, real typing afterwards searches normally.
  const suppressDepartureSearchRef = useRef(false);
  const suppressDestinationSearchRef = useRef(false);
  // The geocoded state paired with departureCoordinate, same lifecycle.
  // Not persisted on journeyDetails (nothing downstream needs the raw
  // state name once jurisdictionCode is derived from it), only used by
  // the jurisdiction-determination effect below.
  const [departureState, setDepartureState] = useState<string | null>(null);
  const [isFetchingDrivingHours, setIsFetchingDrivingHours] = useState(false);

  const [journeyDetails, setJourneyDetails] = useState<JourneyDetails>({
    departureLocation: "",
    departureCoordinate: null,
    destination: [],
    vehicleType: "",
    fuelType: "",
    fuelLevel: "",
    departureDate: "",
    departureTime: "",
    arrivalDate: "",
    arrivalTime: "",
    hasCoDriver: false,
    jurisdictionCode: "",
    estimatedDrivingHours: "",
  });

  // "Edit" from the Route & Breaks page just links back here, this page
  // never itself loaded the journey it had already saved, so editing
  // meant starting over from a blank form every time (a real bug: every
  // field here is either blank, or throws away a previous submission's
  // saved coordinates/state). Starts empty and hydrates from localStorage
  // in an effect (not a lazy useState initializer) so the server render
  // and first browser render stay aligned, same reasoning as the
  // route-breaks page's useSyncExternalStore usage.
  useEffect(() => {
    queueMicrotask(() => {
      try {
        const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
        if (raw) {
          const saved: JourneyDetails = JSON.parse(raw);
          // Restoring a saved departure changes departureLocation, which
          // the debounced search effect would otherwise treat as typing
          // and reopen the suggestions dropdown over a form the driver
          // has not touched yet. Same suppression the suggestion click
          // uses.
          if (saved.departureLocation) {
            suppressDepartureSearchRef.current = true;
          }
          setJourneyDetails(saved);
        }
      } catch {
        // Corrupt or unavailable storage, just start blank, not fatal.
      }
    });
  }, []);

  // Errors are shown only after the first submit attempt (so a blank form
  // is not covered in red before the driver has typed anything), and from
  // then on they track the live values, see computeJourneyErrors.
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const journeyDetailsError = useMemo(
    () =>
      hasSubmitted
        ? computeJourneyErrors(journeyDetails, destinationInput)
        : EMPTY_ERRORS,
    [hasSubmitted, journeyDetails, destinationInput],
  );

  // US 1.3: the computed rest plan, once the backend has responded.
  // null means "not requested yet", an empty array is a real, valid
  // answer meaning no rest is legally required for this journey. Only
  // ever set when the driver has to stay on this page (schedule too
  // tight), see handleSubmit.
  const [restPlan, setRestPlan] = useState<RestBreak[] | null>(null);
  const [isLoadingRestPlan, setIsLoadingRestPlan] = useState(false);
  const [restPlanError, setRestPlanError] = useState<string>("");

  const searchGeocodeSuggestions = async (
    query: string,
    setSuggestions: (suggestions: GeocodeSuggestion[]) => void,
    setIsSearching: (isSearching: boolean) => void,
    setError: (error: string) => void,
    signal: AbortSignal,
  ) => {
    const cleanQuery = query.trim();

    if (cleanQuery.length < 3) {
      setSuggestions([]);
      return;
    }

    setIsSearching(true);
    setError("");

    try {
      const response = await fetch(
        `${API_BASE_URL}/geocode?query=${encodeURIComponent(cleanQuery)}&limit=5`,
        { signal },
      );

      if (!response.ok) {
        throw new Error("Geocoding request failed.");
      }

      const suggestions: GeocodeSuggestion[] = await response.json();
      setSuggestions(suggestions);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }

      setSuggestions([]);
      setError(
        "Could not search locations. Check that the backend is running.",
      );
    } finally {
      if (!signal.aborted) {
        setIsSearching(false);
      }
    }
  };

  useEffect(() => {
    if (suppressDepartureSearchRef.current) {
      // This change came from clicking a suggestion, not typing, skip
      // the one search it would otherwise trigger and consume the flag.
      suppressDepartureSearchRef.current = false;
      return;
    }

    const controller = new AbortController();
    const searchDelay = window.setTimeout(() => {
      searchGeocodeSuggestions(
        journeyDetails.departureLocation,
        setDepartureSuggestions,
        setIsSearchingDeparture,
        setDepartureGeocodingError,
        controller.signal,
      );
    }, 350);

    return () => {
      controller.abort();
      window.clearTimeout(searchDelay);
    };
  }, [journeyDetails.departureLocation]);

  useEffect(() => {
    if (suppressDestinationSearchRef.current) {
      suppressDestinationSearchRef.current = false;
      return;
    }

    const controller = new AbortController();
    const searchDelay = window.setTimeout(() => {
      searchGeocodeSuggestions(
        destinationInput,
        setDestinationSuggestions,
        setIsSearchingDestination,
        setDestinationGeocodingError,
        controller.signal,
      );
    }, 350);

    return () => {
      controller.abort();
      window.clearTimeout(searchDelay);
    };
  }, [destinationInput]);

  // Re-derives jurisdictionCode whenever the set of resolved states
  // (departure + every destination that has one) changes, rather than
  // only reacting to the departure suggestion click, so adding or
  // removing a destination after departure was already picked correctly
  // re-evaluates this too.
  //
  // Priority, deliberately: WA anywhere in the trip (departure OR any
  // destination) always wins, the whole plan uses WA's rules. This is a
  // real simplification, not a precise per-segment answer, a route that
  // only touches WA briefly still gets WA's numbers for the entire
  // journey, but it is a considered product decision, not an oversight.
  // NT needs no such override at all: its seeded numbers are identical
  // to the six HVNL states (see seed_fatigue_rules_wa_nt.sql, borrowed
  // on purpose since NT has none of its own), so NT appearing anywhere
  // alongside an HVNL state never actually changes the computed plan,
  // only the informational note shown once NT is involved.
  useEffect(() => {
    const resolvedStates = [
      departureState,
      ...journeyDetails.destination.map(
        (destination) => destination.state ?? null,
      ),
    ].filter((state): state is string => state !== null);

    if (resolvedStates.length === 0) {
      // Nothing geocoded yet, leave whatever the driver already picked
      // manually alone.
      return;
    }

    const anyWA = resolvedStates.includes(WA_STATE_NAME);
    const anyNT = resolvedStates.includes(NT_STATE_NAME);

    // Computed as a plain value first, applied in a microtask below
    // rather than synchronously in the effect body, avoiding a same-tick
    // cascading render (same reasoning as the route-fetch effects).
    let jurisdictionCode: string | undefined;

    if (anyWA) {
      jurisdictionCode = "WA";
    } else if (anyNT) {
      jurisdictionCode = "NT";
    } else {
      // Everything resolved is one of the six identical HVNL states,
      // departure's is as good as any of them to display.
      jurisdictionCode = departureState
        ? STATE_TO_JURISDICTION[departureState]
        : undefined;
    }

    queueMicrotask(() => {
      if (jurisdictionCode !== undefined) {
        setJourneyDetails((prev) => ({
          ...prev,
          jurisdictionCode: jurisdictionCode as string,
        }));
      }
    });
  }, [departureState, journeyDetails.destination]);

  // Once a real departure and at least one real destination coordinate
  // exist (both from picked geocode suggestions, never guessed), fetch
  // the actual routed duration and use it to fill Est. Driving Hours.
  // Failures here are silent on purpose: the field simply stays
  // unresolved and the form cannot be submitted (see
  // computeJourneyErrors), no error banner is needed for a background
  // step failing, the field's own placeholder already says what it is
  // waiting on.
  useEffect(() => {
    const hasResolvedRouteCoordinates =
      journeyDetails.departureCoordinate !== null &&
      journeyDetails.destination.length > 0 &&
      journeyDetails.destination.every(
        (destination) =>
          destination.lat !== undefined && destination.lng !== undefined,
      );

    if (!hasResolvedRouteCoordinates) {
      return;
    }

    const controller = new AbortController();

    (async () => {
      setIsFetchingDrivingHours(true);

      try {
        const waypoints = [
          journeyDetails.departureCoordinate,
          ...journeyDetails.destination.map((destination) => ({
            lat: destination.lat as number,
            lng: destination.lng as number,
          })),
        ];

        const response = await fetch(`${API_BASE_URL}/journeys/route`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ waypoints }),
          signal: controller.signal,
        });

        if (!response.ok) {
          return;
        }

        const data: { duration_hours: number } = await response.json();

        // Always overwrites, this field is no longer manually editable
        // (see the section comment above the Jurisdiction/Est. Driving
        // Hours fields), so there is no driver-typed value to protect
        // here. If it were guarded on "already has a value" the way an
        // earlier version of this effect did, the number would go
        // stale the moment a destination changes after the first
        // auto-fill, since this effect's dependency array only re-runs
        // on a real departure/destination change, not on every render.
        setJourneyDetails((prev) => ({
          ...prev,
          estimatedDrivingHours: data.duration_hours.toFixed(1),
        }));
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        // Silent: see the comment above this effect.
      } finally {
        if (!controller.signal.aborted) {
          setIsFetchingDrivingHours(false);
        }
      }
    })();

    return () => controller.abort();
  }, [journeyDetails.departureCoordinate, journeyDetails.destination]);

  const removeDestination = (destId: string) => {
    setJourneyDetails({
      ...journeyDetails,
      destination: journeyDetails.destination.filter(
        (dest) => dest.id !== destId,
      ),
    });
  };

  // Shared by the suggestion click and the Enter key (BA item 6: the two
  // must do the same thing). Commits the pick straight into journey
  // state, there is no separate confirm step.
  const selectDepartureSuggestion = (suggestion: GeocodeSuggestion) => {
    suppressDepartureSearchRef.current = true;
    setJourneyDetails((prev) => ({
      ...prev,
      departureLocation: suggestion.label,
      departureCoordinate: suggestion.coordinate,
    }));
    // jurisdictionCode itself is set by the jurisdiction-determination
    // effect above, once it sees this new departureState alongside
    // whatever destinations are already resolved, not here, so adding a
    // destination later (or removing one) correctly re-evaluates the
    // same decision instead of only reacting to the departure click.
    setDepartureState(suggestion.state);
    setDepartureSuggestions([]);
  };

  const selectDestinationSuggestion = (suggestion: GeocodeSuggestion) => {
    suppressDestinationSearchRef.current = true;
    setJourneyDetails((prev) => ({
      ...prev,
      destination: [
        ...prev.destination,
        {
          // Stable IDs keep drag, render, and remove behavior correct even
          // when two destinations have the same label.
          id: crypto.randomUUID(),
          label: suggestion.label,
          // Always present for a picked suggestion, which is now the only
          // way a destination can be added, so every new entry is
          // routable. The optional typing on Destination remains for
          // drafts saved by older versions of this form.
          lat: suggestion.coordinate.lat,
          lng: suggestion.coordinate.lng,
          ...(suggestion.state ? { state: suggestion.state } : {}),
        },
      ],
    }));
    // The box empties, ready for an optional next stop.
    setDestinationInput("");
    setDestinationSuggestions([]);
  };

  // Calls the backend's rest-plan endpoint (US 1.3) for the journey just
  // saved. Kept separate from handleSubmit so a failed network call is
  // its own, clearly scoped concern, distinct from form validation.
  // Returns the fetched plan (an empty array is a real, valid "no rest
  // required" answer), or null on failure, so handleSubmit can decide
  // whether it is safe to navigate to the Route & Breaks page,
  // navigating there after a failure would silently show whatever plan
  // (if any) was left over from a previous, unrelated submission.
  //
  // Deliberately does NOT put the plan into restPlan state. Doing so
  // mounted the whole Schedule Analysis and rest plan list for one
  // frame before router.push navigated away, the visible "flash" the
  // BA reported after Start Journey (item 8). handleSubmit decides
  // whether the plan needs showing at all. Likewise the loading flag is
  // left on across a successful fetch, the button keeps reading
  // "Checking rest requirements..." until either navigation completes
  // or handleSubmit shows the too-tight warning.
  const fetchRestPlan = async (
    details: JourneyDetails,
  ): Promise<RestBreak[] | null> => {
    setIsLoadingRestPlan(true);
    setRestPlanError("");
    setRestPlan(null);

    // fetch() itself throwing (offline, DNS failure, CORS block, backend
    // not running) and the backend responding with a real HTTP error are
    // different failure modes with different honest messages, so they
    // are caught separately rather than folded into one try/catch. Both
    // throw a real Error object, so branching on `instanceof Error`
    // cannot tell them apart, the earlier version of this code tried to
    // and the network-failure message was consequently unreachable.
    let response: Response;
    try {
      response = await fetch(`${API_BASE_URL}/journeys/rest-plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          departure_time: `${details.departureDate}T${details.departureTime}:00`,
          jurisdiction_code: details.jurisdictionCode,
          // A co-driver being present is what actually changes which
          // NHVR limits apply (a shorter major rest is allowed once a
          // second driver can take over).
          configuration: details.hasCoDriver ? "two_up" : "solo",
          total_driving_hours: Number(details.estimatedDrivingHours),
        }),
      });
    } catch {
      setRestPlanError(
        "Could not reach the rest plan service. Check that the backend is running.",
      );
      setIsLoadingRestPlan(false);
      return null;
    }

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setRestPlanError(
        body?.detail ?? `Request failed with status ${response.status}`,
      );
      setIsLoadingRestPlan(false);
      return null;
    }

    const plan: RestBreak[] = await response.json();
    // Keep the generated break times so Route & Breaks can match them to
    // safe stop locations.
    localStorage.setItem(REST_PLAN_STORAGE_KEY, JSON.stringify(plan));
    return plan;
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    // Clear any previously displayed plan before re-validating. Without
    // this, editing the form after a too-tight result and then
    // resubmitting with an invalid field would leave the OLD rest plan
    // on screen with nothing to show it no longer matches the current
    // form values, a real safety concern for a rest-planning app.
    setRestPlan(null);
    setRestPlanError("");

    setHasSubmitted(true);
    if (hasAnyError(computeJourneyErrors(journeyDetails, destinationInput))) {
      return;
    }

    // Journey details are personal to this driver and stay on this
    // device, never sent to the backend, only the fields the rest-plan
    // calculation actually needs (below) leave the browser.
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(journeyDetails));

    const plan = await fetchRestPlan(journeyDetails);
    if (plan === null) {
      return; // Failed, restPlanError is already showing why, stay put.
    }

    // Only auto-navigate to Route & Breaks when the schedule actually
    // works: computed directly from the freshly returned plan, not the
    // restPlan/scheduleAnalysis state, those have not re-rendered yet
    // inside this same function call. When the schedule is too tight,
    // stay on this page so the driver actually sees the Schedule
    // Analysis warning, navigating straight past it would defeat the
    // entire point of computing it.
    const departure = new Date(
      `${journeyDetails.departureDate}T${journeyDetails.departureTime}:00`,
    );
    const target = new Date(
      `${journeyDetails.arrivalDate}T${journeyDetails.arrivalTime}:00`,
    );
    const drivingHours = Number(journeyDetails.estimatedDrivingHours || 0);
    const totalRestMinutes = plan.reduce(
      (sum, restBreak) =>
        sum +
        (new Date(restBreak.end).getTime() -
          new Date(restBreak.start).getTime()) /
          60000,
      0,
    );
    const safeArrival = new Date(
      departure.getTime() + (drivingHours * 60 + totalRestMinutes) * 60000,
    );

    if (safeArrival.getTime() <= target.getTime()) {
      // Navigate without ever rendering the plan here: this page is
      // about to unmount, and painting the analysis first is exactly the
      // flash being avoided. isLoadingRestPlan stays true on purpose.
      router.push("/state-check");
      return;
    }

    // Too tight: now the plan and the warning genuinely need showing.
    setRestPlan(plan);
    setIsLoadingRestPlan(false);
  };

  // Compares the driver's own stated target arrival against the
  // earliest arrival actually possible once mandatory rest is
  // accounted for (departure + driving + every break's duration, the
  // same calculation route-breaks/page.tsx's "Current ETA" uses). A
  // target that comes before the safe arrival means the trip as
  // planned does not leave enough time for the legally required rest,
  // worth surfacing directly rather than leaving the driver to notice
  // only once they are already on the road.
  const scheduleAnalysis = useMemo(() => {
    if (restPlan === null) {
      return null;
    }
    const departure =
      journeyDetails.departureDate && journeyDetails.departureTime
        ? new Date(
            `${journeyDetails.departureDate}T${journeyDetails.departureTime}:00`,
          )
        : null;
    const target =
      journeyDetails.arrivalDate && journeyDetails.arrivalTime
        ? new Date(
            `${journeyDetails.arrivalDate}T${journeyDetails.arrivalTime}:00`,
          )
        : null;
    const drivingHours = Number(journeyDetails.estimatedDrivingHours || 0);
    if (!departure || !target || !drivingHours) {
      return null;
    }

    const totalRestMinutes = restPlan.reduce(
      (sum, restBreak) =>
        sum +
        (new Date(restBreak.end).getTime() -
          new Date(restBreak.start).getTime()) /
          60000,
      0,
    );
    const totalDrivingMinutes = drivingHours * 60;
    const safeArrival = new Date(
      departure.getTime() + (totalDrivingMinutes + totalRestMinutes) * 60000,
    );

    return {
      safeArrival,
      target,
      isTooTight: safeArrival.getTime() > target.getTime(),
      totalDrivingMinutes,
      totalRestMinutes,
      shortBreakCount: restPlan.filter((b) => !isMajorRest(b.reason)).length,
      majorRestCount: restPlan.filter((b) => isMajorRest(b.reason)).length,
    };
  }, [restPlan, journeyDetails]);

  const hasDestinations = journeyDetails.destination.length > 0;

  return (
    <div className="container mx-auto max-w-2xl px-4">
      <form onSubmit={handleSubmit} noValidate>
        <div className="flex flex-col items-center justify-between gap-2 min-h-screen">
          <div className="flex items-center justify-between w-full mt-4">
            {/* Top */}
            <h1 className="text-lg font-bold">New Journey</h1>
          </div>

          {/* Departure Location */}
          <div className="flex flex-col gap-2 w-full">
            <label htmlFor="departure-location" className={LABEL_CLASS}>
              Departure location
            </label>
            <input
              id="departure-location"
              type="text"
              autoComplete="off"
              placeholder="Search for where you are leaving from"
              value={journeyDetails.departureLocation}
              className={INPUT_CLASS}
              onChange={(e) => {
                const value = e.target.value;
                setJourneyDetails({
                  ...journeyDetails,
                  departureLocation: value,
                  // Typing invalidates whatever suggestion was previously
                  // selected, the text no longer necessarily matches it.
                  departureCoordinate: null,
                });
                setDepartureState(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setDepartureSuggestions([]);
                  return;
                }
                if (e.key !== "Enter") {
                  return;
                }
                // Enter in a search box picks the top suggestion, it never
                // submits the whole form (BA item 6). Without this the
                // browser's implicit submission fired Start Journey.
                e.preventDefault();
                if (departureSuggestions[0]) {
                  selectDepartureSuggestion(departureSuggestions[0]);
                }
              }}
            />
            {isSearchingDeparture && (
              <p className={HELPER_CLASS}>Searching locations...</p>
            )}
            {departureSuggestions.length > 0 && (
              <div
                role="listbox"
                aria-label="Departure suggestions"
                className="flex flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-sm"
              >
                {departureSuggestions.map((suggestion) => (
                  <button
                    key={`${suggestion.label}-${suggestion.coordinate.lat}-${suggestion.coordinate.lng}`}
                    type="button"
                    role="option"
                    aria-selected={false}
                    className="px-3 py-2 text-left transition hover:bg-surface-alt active:bg-brand-tint"
                    onClick={() => selectDepartureSuggestion(suggestion)}
                  >
                    <span className="block text-sm text-ink">
                      {shortenLocationLabel(suggestion.label)}
                    </span>
                    {/* The full geocoder string stays visible in small
                        print so two same-named places stay tellable
                        apart (BA item 3 asked for shorter names, not
                        less information). */}
                    <span className="block text-xs text-muted">
                      {suggestion.label}
                    </span>
                  </button>
                ))}
              </div>
            )}
            <FieldError message={departureGeocodingError} />
            <FieldError message={journeyDetailsError.departureLocation} />
          </div>

          {/* Destinations. The list of chosen stops sits above the search
              box so the page reads as "what you have, then add more". */}
          <div className="flex flex-col gap-2 w-full">
            <label htmlFor="destination-search" className={LABEL_CLASS}>
              {hasDestinations ? "Add another stop (optional)" : "Destination"}
            </label>
            {hasDestinations && (
              <DragDropProvider
                onDragEnd={(event) => {
                  // dnd-kit provides the old/new positions; move() returns
                  // the same destinations in their updated order.
                  setJourneyDetails((prev) => ({
                    ...prev,
                    destination: move(prev.destination, event),
                  }));
                }}
              >
                <ol className="flex flex-col gap-2">
                  {journeyDetails.destination.map((destination, index) => (
                    <SortableDestination
                      key={destination.id}
                      id={destination.id}
                      index={index}
                      destination={destination}
                      onRemove={removeDestination}
                    />
                  ))}
                </ol>
              </DragDropProvider>
            )}
            <input
              id="destination-search"
              type="text"
              autoComplete="off"
              placeholder={
                hasDestinations
                  ? "Search for another destination"
                  : "Search for your destination"
              }
              value={destinationInput}
              className={INPUT_CLASS}
              onChange={(e) => setDestinationInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setDestinationSuggestions([]);
                  return;
                }
                if (e.key !== "Enter") {
                  return;
                }
                e.preventDefault();
                if (destinationSuggestions[0]) {
                  selectDestinationSuggestion(destinationSuggestions[0]);
                }
              }}
            />
            <p className={HELPER_CLASS}>
              Pick a suggestion to add it.
              {hasDestinations ? " Drag to reorder your stops." : ""}
            </p>
            {isSearchingDestination && (
              <p className={HELPER_CLASS}>Searching locations...</p>
            )}
            {destinationSuggestions.length > 0 && (
              <div
                role="listbox"
                aria-label="Destination suggestions"
                className="flex flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-sm"
              >
                {destinationSuggestions.map((suggestion) => (
                  <button
                    key={`${suggestion.label}-${suggestion.coordinate.lat}-${suggestion.coordinate.lng}`}
                    type="button"
                    role="option"
                    aria-selected={false}
                    className="px-3 py-2 text-left transition hover:bg-surface-alt active:bg-brand-tint"
                    onClick={() => selectDestinationSuggestion(suggestion)}
                  >
                    <span className="block text-sm text-ink">
                      {shortenLocationLabel(suggestion.label)}
                    </span>
                    <span className="block text-xs text-muted">
                      {suggestion.label}
                    </span>
                  </button>
                ))}
              </div>
            )}
            <FieldError message={destinationGeocodingError} />
            <FieldError message={journeyDetailsError.destination} />
          </div>

          {/* Vehicle Type */}
          <div className="flex flex-col gap-2 mt-1 w-full">
            <label htmlFor="vehicle-type" className={LABEL_CLASS}>
              Vehicle type
            </label>
            <div className="relative">
              <select
                id="vehicle-type"
                className={SELECT_CLASS}
                value={journeyDetails.vehicleType}
                onChange={(e) =>
                  setJourneyDetails({
                    ...journeyDetails,
                    vehicleType: e.target.value,
                  })
                }
              >
                <option value="">Select vehicle type</option>
                {vehicleTypes.map((type) => (
                  <option key={type} value={type.toLowerCase()}>
                    {type}
                  </option>
                ))}
              </select>
              <ChevronDown
                aria-hidden
                className="absolute pointer-events-none right-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted"
              />
            </div>
            <FieldError message={journeyDetailsError.vehicleType} />
          </div>

          {/* Fuel Type & Remaining range */}
          <div className={`flex flex-col gap-2 mt-1 w-full ${PANEL_CLASS}`}>
            <label htmlFor="fuel-type" className={LABEL_CLASS}>
              Fuel type
            </label>
            <div className="relative">
              <select
                id="fuel-type"
                className={SELECT_CLASS}
                value={journeyDetails.fuelType}
                onChange={(e) =>
                  setJourneyDetails({
                    ...journeyDetails,
                    fuelType: e.target.value,
                  })
                }
              >
                <option value="">Select fuel type</option>
                {fuelTypes.map((type) => (
                  <option key={type} value={type.toLowerCase()}>
                    {type}
                  </option>
                ))}
              </select>
              {/* pointer-events-none so a tap on the chevron opens the
                  select underneath instead of hitting the icon (BA item
                  9, the icon was a "button that did nothing"). */}
              <ChevronDown
                aria-hidden
                className="absolute pointer-events-none right-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted"
              />
            </div>
            <FieldError message={journeyDetailsError.fuelType} />
            {/* Rest + refuel matching (US 2.2) only knows diesel outlets;
                there is no usable heavy-vehicle charging dataset for
                Australia yet. Electric stays selectable so the rest of
                the plan still works, this is an honest limitation notice,
                not a validation error. */}
            {journeyDetails.fuelType === "electric" && (
              <p className={HELPER_CLASS}>
                Heavy-vehicle charging data is not yet available for Australia,
                so refuelling stops cannot be matched for an electric vehicle.
                Rest planning still works as normal.
              </p>
            )}
            <div className="flex flex-col gap-2 mt-1 w-full">
              <label htmlFor="remaining-range" className={LABEL_CLASS}>
                Remaining range in km
              </label>
              <input
                id="remaining-range"
                type="text"
                inputMode="numeric"
                placeholder="e.g. 150"
                className={INPUT_CLASS}
                value={journeyDetails.fuelLevel}
                onChange={(e) => {
                  setJourneyDetails({
                    ...journeyDetails,
                    fuelLevel: e.target.value,
                  });
                }}
              />
              <FieldError message={journeyDetailsError.fuelLevel} />
            </div>
          </div>

          {/* Jurisdiction & Estimated Driving Hours */}
          {/* Both are fully computed, not editable: jurisdictionCode
              from the departure's (and every destination's) geocoded
              state, estimatedDrivingHours from the real routed
              duration (see the effects above). A driver typing free
              text without picking a real geocode suggestion never gets
              a coordinate, so these stay unresolved and the form
              cannot be submitted, real data is required here rather
              than letting a guess silently feed a fatigue calculation. */}
          <p className={`${HELPER_CLASS} mt-1 w-full`}>
            NHVR rest rules are national, so which of VIC, NSW, QLD, SA, TAS or
            the ACT you drive in rarely changes your plan. Western Australia
            runs its own scheme. The Northern Territory has no fixed limits, so
            the national figures are used as a safe default.
          </p>
          <div className="grid w-full grid-cols-2 gap-4 mt-1">
            <div className="flex flex-col gap-2">
              <span className={LABEL_CLASS}>
                Jurisdiction
                <span className="ml-2 rounded-full bg-brand-tint px-2 py-0.5 text-[10px] font-bold tracking-wide text-brand-strong">
                  AUTO
                </span>
              </span>
              <div className={READONLY_FIELD_CLASS}>
                {journeyDetails.jurisdictionCode ? (
                  jurisdictionOptions.find(
                    (jurisdiction) =>
                      jurisdiction.code === journeyDetails.jurisdictionCode,
                  )?.name
                ) : (
                  <span className="text-muted">
                    From your departure and destination
                  </span>
                )}
              </div>
              {journeyDetails.jurisdictionCode === "NT" && (
                <p className={HELPER_CLASS}>
                  The NT has no fixed driving-hour limits of its own. RouteRest
                  applies the national NHVR figures as a conservative default.
                </p>
              )}
              {journeyDetails.jurisdictionCode === "WA" && (
                <p className={HELPER_CLASS}>
                  WA uses its own WorkSafe rest scheme, not the national NHVR
                  rules. Because this trip touches WA, WA&apos;s figures apply
                  to the whole journey.
                </p>
              )}
              <FieldError message={journeyDetailsError.jurisdictionCode} />
            </div>

            <div className="flex flex-col gap-2">
              <span className={LABEL_CLASS}>
                Est. driving hours
                <span className="ml-2 rounded-full bg-brand-tint px-2 py-0.5 text-[10px] font-bold tracking-wide text-brand-strong">
                  AUTO
                </span>
              </span>
              <div className={READONLY_FIELD_CLASS}>
                {isFetchingDrivingHours ? (
                  <span className="text-muted">
                    Calculating from your route...
                  </span>
                ) : journeyDetails.estimatedDrivingHours ? (
                  `${journeyDetails.estimatedDrivingHours} hours`
                ) : (
                  <span className="text-muted">From your route</span>
                )}
              </div>
              <FieldError message={journeyDetailsError.estimatedDrivingHours} />
            </div>
          </div>

          {/* Departure & target arrival. Native date/time pickers on
              purpose: on a phone they open the OS wheel picker, and the
              am/pm segment the BA asked about (item 14) is simply how
              the device renders one time control in a 12-hour locale,
              the stored value is always HH:mm. The helper line says so
              rather than adding separate hour/minute/am-pm selects. */}
          <div className={`flex w-full flex-col gap-3 ${PANEL_CLASS}`}>
            <p className={HELPER_CLASS}>
              Times follow your device&apos;s format (12-hour with am/pm, or
              24-hour).
            </p>
            <div className="grid w-full grid-cols-2 gap-4">
              <div className="flex w-full flex-col gap-3">
                <div className="flex flex-col gap-2">
                  <label htmlFor="departure-date" className={LABEL_CLASS}>
                    Departure date
                  </label>
                  <input
                    id="departure-date"
                    type="date"
                    className={INPUT_CLASS}
                    value={journeyDetails.departureDate}
                    onChange={(e) =>
                      setJourneyDetails({
                        ...journeyDetails,
                        departureDate: e.target.value,
                      })
                    }
                  />
                  <FieldError message={journeyDetailsError.departureDate} />
                </div>

                <div className="flex flex-col gap-2">
                  <label htmlFor="departure-time" className={LABEL_CLASS}>
                    Departure time
                  </label>
                  <input
                    id="departure-time"
                    type="time"
                    className={INPUT_CLASS}
                    value={journeyDetails.departureTime}
                    onChange={(e) =>
                      setJourneyDetails({
                        ...journeyDetails,
                        departureTime: e.target.value,
                      })
                    }
                  />
                  <FieldError message={journeyDetailsError.departureTime} />
                </div>
              </div>

              <div className="flex w-full flex-col gap-3">
                <div className="flex flex-col gap-2">
                  <label htmlFor="arrival-date" className={LABEL_CLASS}>
                    Target arrival date
                  </label>
                  <input
                    id="arrival-date"
                    type="date"
                    className={INPUT_CLASS}
                    value={journeyDetails.arrivalDate}
                    onChange={(e) =>
                      setJourneyDetails({
                        ...journeyDetails,
                        arrivalDate: e.target.value,
                      })
                    }
                  />
                  <FieldError message={journeyDetailsError.arrivalDate} />
                </div>

                <div className="flex flex-col gap-2">
                  <label htmlFor="arrival-time" className={LABEL_CLASS}>
                    Target arrival time
                  </label>
                  <input
                    id="arrival-time"
                    type="time"
                    className={INPUT_CLASS}
                    value={journeyDetails.arrivalTime}
                    onChange={(e) =>
                      setJourneyDetails({
                        ...journeyDetails,
                        arrivalTime: e.target.value,
                      })
                    }
                  />
                  <FieldError message={journeyDetailsError.arrivalTime} />
                </div>
              </div>
            </div>
          </div>
          <div className="w-full">
            <FieldError message={journeyDetailsError.dateTimeRange} />
          </div>

          {/* Co-Driver: presence/absence is all that actually matters,
              it decides solo vs two_up for the rest-plan calculation
              (a shorter major rest applies once a second driver can take
              over), no name is collected or shown anywhere in the app. */}
          <div className="flex w-full items-center gap-3 mt-1">
            <input
              id="has-co-driver"
              type="checkbox"
              checked={journeyDetails.hasCoDriver}
              className="h-5 w-5 rounded border-line-strong accent-brand focus:ring-brand-soft/40"
              onChange={(e) =>
                setJourneyDetails({
                  ...journeyDetails,
                  hasCoDriver: e.target.checked,
                })
              }
            />
            <label htmlFor="has-co-driver" className={LABEL_CLASS}>
              Travelling with a co-driver
            </label>
          </div>

          {/* Submit Button */}
          <div className="flex w-full flex-col gap-2">
            <button
              className={PRIMARY_BUTTON_CLASS}
              type="submit"
              disabled={isLoadingRestPlan}
            >
              {isLoadingRestPlan
                ? "Checking rest requirements..."
                : "Start Journey"}
            </button>
            <Disclaimer className="mt-1" />
          </div>

          {restPlanError && (
            <p role="alert" className="w-full text-sm text-danger mt-1">
              {restPlanError}
            </p>
          )}

          {/* Schedule Analysis: your stated target arrival vs. the
              earliest arrival actually possible once mandatory rest is
              included. Only rendered when the driver has to stay on this
              page because the schedule is too tight, see handleSubmit
              and scheduleAnalysis above. */}
          {scheduleAnalysis && (
            <div className="flex w-full flex-col gap-2 mt-1">
              <h2 className="text-lg font-bold">Schedule Analysis</h2>

              {scheduleAnalysis.isTooTight ? (
                <div className="rounded-xl border-2 border-danger-line bg-danger-tint px-3 py-2">
                  <p className="text-sm font-bold text-danger">
                    Schedule too tight
                  </p>
                  <p className="mt-1 text-sm text-ink">
                    Your target arrival doesn&apos;t leave enough time for the
                    mandatory rest breaks below. The earliest you can legally
                    arrive is{" "}
                    <span className="font-semibold">
                      {BREAK_TIME_FORMAT.format(scheduleAnalysis.safeArrival)}
                    </span>
                    .
                  </p>
                </div>
              ) : (
                <div className="rounded-xl border border-brand bg-brand-tint px-3 py-2">
                  <p className="text-sm font-bold text-brand-strong">
                    Schedule allows for required rest
                  </p>
                  <p className="mt-1 text-sm text-ink">
                    Earliest possible arrival, including mandatory rest, is{" "}
                    <span className="font-semibold">
                      {BREAK_TIME_FORMAT.format(scheduleAnalysis.safeArrival)}
                    </span>
                    , before your target.
                  </p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className={PANEL_CLASS}>
                  <p className="text-xs font-semibold uppercase text-muted">
                    Your target
                  </p>
                  <p className="mt-1 font-semibold text-ink">
                    {BREAK_TIME_FORMAT.format(scheduleAnalysis.target)}
                  </p>
                </div>
                <div className={PANEL_CLASS}>
                  <p className="text-xs font-semibold uppercase text-muted">
                    Safe arrival
                  </p>
                  <p
                    className={`mt-1 font-semibold ${
                      scheduleAnalysis.isTooTight
                        ? "text-danger"
                        : "text-brand-strong"
                    }`}
                  >
                    {BREAK_TIME_FORMAT.format(scheduleAnalysis.safeArrival)}
                  </p>
                </div>
                <div className={PANEL_CLASS}>
                  <p className="text-xs font-semibold uppercase text-muted">
                    Total drive time
                  </p>
                  <p className="mt-1 font-semibold text-ink">
                    {formatDurationMinutes(
                      scheduleAnalysis.totalDrivingMinutes,
                    )}
                  </p>
                </div>
                <div className={PANEL_CLASS}>
                  <p className="text-xs font-semibold uppercase text-muted">
                    Total rest time
                  </p>
                  <p className="mt-1 font-semibold text-ink">
                    {formatDurationMinutes(scheduleAnalysis.totalRestMinutes)}
                  </p>
                </div>
              </div>

              {(scheduleAnalysis.shortBreakCount > 0 ||
                scheduleAnalysis.majorRestCount > 0) && (
                <p className="text-sm text-muted">
                  {scheduleAnalysis.shortBreakCount} short break
                  {scheduleAnalysis.shortBreakCount === 1 ? "" : "s"} and{" "}
                  {scheduleAnalysis.majorRestCount} major rest
                  {scheduleAnalysis.majorRestCount === 1 ? "" : "s"} required,
                  see the full plan below.
                </p>
              )}
            </div>
          )}

          {/* Rest plan results (US 1.3, AC 1.3.3: displayed in journey
              order, which the backend already guarantees, see
              generate_rest_plan's docstring). Only rendered once a plan
              has actually come back, not while still null. */}
          {restPlan !== null && (
            <div className="flex w-full flex-col gap-2 mt-1">
              <h2 className="text-lg font-bold">Your Rest Plan</h2>
              {restPlan.length === 0 ? (
                <p className="text-sm text-muted">
                  No rest breaks are legally required for a journey this short.
                </p>
              ) : (
                <>
                  {/* A one-line plain-language summary before the list,
                      so the driver knows what they are looking at before
                      reading nine timestamps. */}
                  <p className="text-sm text-muted">
                    {restPlan.filter((b) => !isMajorRest(b.reason)).length}{" "}
                    short break
                    {restPlan.filter((b) => !isMajorRest(b.reason)).length === 1
                      ? ""
                      : "s"}{" "}
                    and {restPlan.filter((b) => isMajorRest(b.reason)).length}{" "}
                    major rest
                    {restPlan.filter((b) => isMajorRest(b.reason)).length === 1
                      ? ""
                      : "s"}{" "}
                    planned.
                  </p>
                  <ol className="flex flex-col gap-2">
                    {restPlan.map((restBreak, index) => {
                      const major = isMajorRest(restBreak.reason);
                      return (
                        <li
                          key={`${restBreak.start}-${index}`}
                          // Every card keeps the same grey panel fill; the
                          // major rest is distinguished by a brand-green
                          // border, not a different fill, so the text
                          // contrast is identical on every card.
                          className={`${PANEL_CLASS} text-sm text-ink ${
                            major ? "border-2 border-brand" : ""
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span
                              className={`text-xs font-bold uppercase tracking-wide ${
                                major ? "text-brand-strong" : "text-muted"
                              }`}
                            >
                              {major ? "Major Rest" : "Short Break"}
                            </span>
                            <span className="font-semibold">
                              {formatBreakDuration(
                                restBreak.start,
                                restBreak.end,
                              )}
                            </span>
                          </div>
                          <p className="mt-1">
                            {BREAK_TIME_FORMAT.format(
                              new Date(restBreak.start),
                            )}
                          </p>
                          {/* The regulation reference stays visible but
                              secondary, useful detail, not the headline. */}
                          <p className={`${HELPER_CLASS} mt-1`}>
                            {restBreak.reason}
                          </p>
                        </li>
                      );
                    })}
                  </ol>
                </>
              )}
            </div>
          )}

          <div className="mb-2"></div>
        </div>
      </form>
    </div>
  );
}

function SortableDestination({
  id,
  index,
  destination,
  onRemove,
}: {
  id: string;
  index: number;
  destination: Destination;
  onRemove: (id: string) => void;
}) {
  // dnd-kit needs the real list item element to measure and move it.
  const [element, setElement] = useState<Element | null>(null);
  // The handle ref limits dragging to the grip button, so the remove
  // button can still be clicked normally.
  const handleRef = useRef<HTMLButtonElement | null>(null);
  const { isDragging } = useSortable({ id, index, element, handle: handleRef });
  const shortLabel = shortenLocationLabel(destination.label);

  return (
    <li
      ref={setElement}
      className={`flex items-center justify-between gap-3 rounded-xl border border-line bg-surface-alt px-3 py-2 text-sm text-ink ${
        isDragging ? "opacity-50" : ""
      }`}
    >
      {/* Both icon buttons carry a visible tooltip and a screen-reader
          label (BA item 9: an unlabeled "::" and "-" read as buttons with
          no purpose). The grip has no onClick on purpose, dragging is its
          only job. */}
      <button
        ref={handleRef}
        type="button"
        aria-label="Drag to reorder"
        title="Drag to reorder"
        className="shrink-0 cursor-grab rounded p-1 text-muted active:cursor-grabbing"
      >
        <GripVertical className="h-4 w-4" aria-hidden />
      </button>
      <span className="shrink-0 text-muted">{index + 1}.</span>
      <span className="flex-1 truncate" title={destination.label}>
        {shortLabel}
      </span>
      <button
        type="button"
        onClick={() => onRemove(id)}
        aria-label={`Remove ${shortLabel}`}
        title="Remove"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-danger text-white transition active:opacity-90"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </li>
  );
}
