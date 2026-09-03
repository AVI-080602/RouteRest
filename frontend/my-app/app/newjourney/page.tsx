"use client";

import { ChevronDown } from "lucide-react";
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

  // This input is separate from journeyDetails.destination because the
  // typed value only becomes part of the journey after Add Destination.
  const [destinationInput, setDestinationInput] = useState<string>("");
  // The coordinate of whichever destination suggestion was last clicked,
  // if any; cleared whenever the user types, so a coordinate is only ever
  // attached to text that actually came from a real geocode result, never
  // guessed. addDestination reads this when building the new Destination.
  const [destinationInputCoordinate, setDestinationInputCoordinate] = useState<{
    lat: number;
    lng: number;
  } | null>(null);
  // The geocoded state paired with destinationInputCoordinate above,
  // same lifecycle (set on suggestion pick, cleared on manual typing).
  const [destinationInputState, setDestinationInputState] = useState<
    string | null
  >(null);
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
          setJourneyDetails(JSON.parse(raw));
        }
      } catch {
        // Corrupt or unavailable storage, just start blank, not fatal.
      }
    });
  }, []);

  const [journeyDetailsError, setJourneyDetailsError] =
    useState<JourneyDetailsError>({
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
    });

  // US 1.3: the computed rest plan, once the backend has responded.
  // null means "not requested yet", an empty array is a real, valid
  // answer meaning no rest is legally required for this journey.
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
      setError("Could not search locations. Check that the backend is running.");
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
      ...journeyDetails.destination.map((destination) => destination.state ?? null),
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
        setJourneyDetails((prev) => ({ ...prev, jurisdictionCode: jurisdictionCode as string }));
      }
    });
  }, [departureState, journeyDetails.destination]);

  // Once a real departure and at least one real destination coordinate
  // exist (both from picked geocode suggestions, never guessed), fetch
  // the actual routed duration and use it to pre-fill Est. Driving
  // Hours, still fully editable, this only ever runs BEFORE the field
  // already has a value the driver typed themselves (see the functional
  // setJourneyDetails update below). Failures here are silent on
  // purpose: this is a convenience default, not a required step, the
  // field just stays manual exactly as it always has, no error banner
  // needed for a background nicety failing.
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

  const addDestination = () => {
    const destination = destinationInput.trim();

    if (!destination) {
      setJourneyDetailsError((prevErrors) => ({
        ...prevErrors,
        destination: "Destination is required.",
      }));
      return;
    }

    setJourneyDetails({
      ...journeyDetails,
      destination: [
        ...journeyDetails.destination,
        {
          // Stable IDs keep drag, render, and remove behavior correct even
          // when two destinations have the same label.
          id: crypto.randomUUID(),
          label: destination,
          // Only present if the text still matches a picked suggestion;
          // undefined if the driver typed free text without selecting
          // one, see the lat/lng comment on the Destination type.
          ...(destinationInputCoordinate ?? {}),
          ...(destinationInputState ? { state: destinationInputState } : {}),
        },
      ],
    });

    setDestinationInput("");
    setDestinationInputCoordinate(null);
    setDestinationInputState(null);
    setJourneyDetailsError((prevErrors) => ({
      ...prevErrors,
      destination: "",
    }));
  };

  // Each validator updates the visible error message and returns a boolean
  // so submit can decide immediately whether saving is allowed.
  const validateDepartureLocation = (departureLocation: string) => {
    if (!departureLocation.trim()) {
      setJourneyDetailsError((prevErrors) => ({
        ...prevErrors,
        departureLocation: "Departure location is required.",
      }));
      return false;
    }

    setJourneyDetailsError((prevErrors) => ({
      ...prevErrors,
      departureLocation: "",
    }));
    return true;
  };

  const validateDestination = (destination: Destination[]) => {
    if (destination.length === 0 || !destination[0]) {
      setJourneyDetailsError((prevErrors) => ({
        ...prevErrors,
        destination: "Destination is required.",
      }));
      return false;
    }

    setJourneyDetailsError((prevErrors) => ({
      ...prevErrors,
      destination: "",
    }));
    return true;
  };

  const validateVehicleType = (vehicleType: string) => {
    if (!vehicleType) {
      setJourneyDetailsError((prevErrors) => ({
        ...prevErrors,
        vehicleType: "Vehicle type is required.",
      }));
      return false;
    }

    setJourneyDetailsError((prevErrors) => ({
      ...prevErrors,
      vehicleType: "",
    }));
    return true;
  };

  const validateFuelLevel = (value: string) => {
    const trimmedValue = value.trim();
    const maxFuelLevel = 5000;

    if (!trimmedValue) {
      setJourneyDetailsError((prevErrors) => ({
        ...prevErrors,
        fuelLevel: "Fuel level is required.",
      }));
      return false;
    }

    if (!/^\d+$/.test(trimmedValue)) {
      setJourneyDetailsError((prevErrors) => ({
        ...prevErrors,
        fuelLevel: "Fuel level must be a valid number.",
      }));
      return false;
    }

    if (parseInt(trimmedValue, 10) > maxFuelLevel) {
      setJourneyDetailsError((prevErrors) => ({
        ...prevErrors,
        fuelLevel: `Fuel level cannot exceed ${maxFuelLevel} liters.`,
      }));
      return false;
    }

    setJourneyDetailsError((prevErrors) => ({
      ...prevErrors,
      fuelLevel: "",
    }));
    return true;
  };

  const validateFuelType = (fuelType: string) => {
    if (!fuelType) {
      setJourneyDetailsError((prevErrors) => ({
        ...prevErrors,
        fuelType: "Fuel type is required.",
      }));
      return false;
    }

    setJourneyDetailsError((prevErrors) => ({
      ...prevErrors,
      fuelType: "",
    }));
    return true;
  };

  const validateJurisdictionCode = (jurisdictionCode: string) => {
    if (!jurisdictionCode) {
      setJourneyDetailsError((prevErrors) => ({
        ...prevErrors,
        jurisdictionCode:
          "Jurisdiction could not be determined yet, pick your departure and destination from the search suggestions (not just typed text).",
      }));
      return false;
    }

    setJourneyDetailsError((prevErrors) => ({
      ...prevErrors,
      jurisdictionCode: "",
    }));
    return true;
  };

  // No longer validates format (NaN, negative, too large): this field
  // is fully computed from a real routed duration (see the effect
  // above), never manually typed, so those paths are unreachable now,
  // the only two real states are "not resolved yet" and "a valid
  // number the backend already computed".
  const validateEstimatedDrivingHours = (value: string) => {
    if (!value.trim()) {
      setJourneyDetailsError((prevErrors) => ({
        ...prevErrors,
        estimatedDrivingHours:
          "Driving hours could not be determined yet, pick your departure and destination from the search suggestions (not just typed text).",
      }));
      return false;
    }

    setJourneyDetailsError((prevErrors) => ({
      ...prevErrors,
      estimatedDrivingHours: "",
    }));
    return true;
  };

  const validateJourneyDateTime = (
    departureDate: string,
    departureTime: string,
    arrivalDate: string,
    arrivalTime: string,
  ) => {
    let isValid = true;

    if (!departureDate) {
      setJourneyDetailsError((prevErrors) => ({
        ...prevErrors,
        departureDate: "Departure date is required.",
      }));
      isValid = false;
    } else {
      setJourneyDetailsError((prevErrors) => ({
        ...prevErrors,
        departureDate: "",
      }));
    }

    if (!departureTime) {
      setJourneyDetailsError((prevErrors) => ({
        ...prevErrors,
        departureTime: "Departure time is required.",
      }));
      isValid = false;
    } else {
      setJourneyDetailsError((prevErrors) => ({
        ...prevErrors,
        departureTime: "",
      }));
    }

    if (!arrivalDate) {
      setJourneyDetailsError((prevErrors) => ({
        ...prevErrors,
        arrivalDate: "Arrival date is required.",
      }));
      isValid = false;
    } else {
      setJourneyDetailsError((prevErrors) => ({
        ...prevErrors,
        arrivalDate: "",
      }));
    }

    if (!arrivalTime) {
      setJourneyDetailsError((prevErrors) => ({
        ...prevErrors,
        arrivalTime: "Arrival time is required.",
      }));
      isValid = false;
    } else {
      setJourneyDetailsError((prevErrors) => ({
        ...prevErrors,
        arrivalTime: "",
      }));
    }

    if (departureDate && departureTime && arrivalDate && arrivalTime) {
      // Only compare the full date-time range after all four fields exist.
      const departureDateTime = new Date(`${departureDate}T${departureTime}`);
      const arrivalDateTime = new Date(`${arrivalDate}T${arrivalTime}`);

      if (departureDateTime >= arrivalDateTime) {
        setJourneyDetailsError((prevErrors) => ({
          ...prevErrors,
          dateTimeRange:
            "Departure date and time must be before arrival date and time.",
        }));
        isValid = false;
      } else {
        setJourneyDetailsError((prevErrors) => ({
          ...prevErrors,
          dateTimeRange: "",
        }));
      }
    }

    return isValid;
  };

  // Calls the backend's rest-plan endpoint (US 1.3) for the journey just
  // saved. Kept separate from handleSubmit so a failed network call is
  // its own, clearly scoped concern, distinct from form validation.
  // Returns the fetched plan (an empty array is a real, valid "no rest
  // required" answer), or null on failure, so handleSubmit can decide
  // whether it is safe to navigate to the Route & Breaks page,
  // navigating there after a failure would silently show whatever plan
  // (if any) was left over from a previous, unrelated submission. A
  // direct return value, not just the restPlan state, because
  // handleSubmit needs the fresh plan synchronously to check schedule
  // tightness before deciding whether to navigate, state updates from
  // setRestPlan below are not visible in handleSubmit's own scope until
  // the next render.
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
    setRestPlan(plan);
    // Keep the generated break times so Route & Breaks can match them to
    // safe stop locations.
    localStorage.setItem(REST_PLAN_STORAGE_KEY, JSON.stringify(plan));
    setIsLoadingRestPlan(false);
    return plan;
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    // Clear any previously displayed plan before re-validating. Without
    // this, editing the form after a successful submission and then
    // resubmitting with an invalid field would leave the OLD rest plan
    // on screen with nothing to show it no longer matches the current
    // form values, a real safety concern for a rest-planning app.
    setRestPlan(null);
    setRestPlanError("");

    const isDepartureLocationValid = validateDepartureLocation(
      journeyDetails.departureLocation,
    );
    const isDestinationValid = validateDestination(journeyDetails.destination);
    const isVehicleTypeValid = validateVehicleType(journeyDetails.vehicleType);
    const isFuelTypeValid = validateFuelType(journeyDetails.fuelType);
    const isFuelLevelValid = validateFuelLevel(journeyDetails.fuelLevel);
    const isJurisdictionValid = validateJurisdictionCode(
      journeyDetails.jurisdictionCode,
    );
    const isEstimatedDrivingHoursValid = validateEstimatedDrivingHours(
      journeyDetails.estimatedDrivingHours,
    );
    const isDateTimeValid = validateJourneyDateTime(
      journeyDetails.departureDate,
      journeyDetails.departureTime,
      journeyDetails.arrivalDate,
      journeyDetails.arrivalTime,
    );

    const isFormValid =
      isDepartureLocationValid &&
      isDestinationValid &&
      isVehicleTypeValid &&
      isFuelTypeValid &&
      isFuelLevelValid &&
      isJurisdictionValid &&
      isEstimatedDrivingHoursValid &&
      isDateTimeValid;

    if (!isFormValid) {
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
    // inside this same function call, they would still reflect the
    // PREVIOUS submission. When the schedule is too tight, stay on this
    // page so the driver actually sees the Schedule Analysis warning,
    // navigating straight past it would defeat the entire point of
    // computing it.
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
      router.push("/route-breaks");
    }
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
    const departure = journeyDetails.departureDate && journeyDetails.departureTime
      ? new Date(`${journeyDetails.departureDate}T${journeyDetails.departureTime}:00`)
      : null;
    const target = journeyDetails.arrivalDate && journeyDetails.arrivalTime
      ? new Date(`${journeyDetails.arrivalDate}T${journeyDetails.arrivalTime}:00`)
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

  return (
    <div className="container mx-auto px-4">
      <form onSubmit={handleSubmit}>
        <div className="flex flex-col items-center justify-between gap-2 min-h-screen">
          <div className="flex items-center justify-between w-full mt-4">
            {/* Top */}
            <h5 className="text-lg font-bold ">New Journey</h5>
          </div>

          {/* Departure Location */}
          <div className="flex flex-col gap-2 w-full">
            <label className="text-sm font-semibold text-slate-400">
              Departure Location
            </label>
            <input
              type="text"
              placeholder="Enter your departure location"
              value={journeyDetails.departureLocation}
              className="h-12 w-full rounded-xl border border-slate-700 bg-slate-900 pl-2 text-base text-white placeholder:text-slate-400 focus:border-yellow-500 focus:outline-none focus:ring-2 focus:ring-yellow-500/30"
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
            />
            {isSearchingDeparture && (
              <p className="text-sm text-slate-400">Searching locations...</p>
            )}
            {departureSuggestions.length > 0 && (
              <div className="flex flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-900">
                {departureSuggestions.map((suggestion) => (
                  <button
                    key={`${suggestion.label}-${suggestion.coordinate.lat}-${suggestion.coordinate.lng}`}
                    type="button"
                    className="px-3 py-2 text-left text-sm text-slate-200 transition hover:bg-slate-800 active:bg-slate-700"
                    onClick={() => {
                      suppressDepartureSearchRef.current = true;
                      setJourneyDetails({
                        ...journeyDetails,
                        departureLocation: suggestion.label,
                        departureCoordinate: suggestion.coordinate,
                      });
                      // jurisdictionCode itself is set by the
                      // jurisdiction-determination effect below, once it
                      // sees this new departureState alongside whatever
                      // destinations are already resolved, not here, so
                      // adding a destination later (or removing one)
                      // correctly re-evaluates the same decision instead
                      // of only reacting to the departure click.
                      setDepartureState(suggestion.state);
                      setDepartureSuggestions([]);
                    }}
                  >
                    {suggestion.label}
                  </button>
                ))}
              </div>
            )}
            {departureGeocodingError && (
              <p className="text-sm text-red-400 mt-1">
                {departureGeocodingError}
              </p>
            )}
            {journeyDetailsError.departureLocation && (
              <p className="text-sm text-red-400 mt-1">
                {journeyDetailsError.departureLocation}
              </p>
            )}
          </div>

          {/* Destination */}
          <div className="flex flex-col gap-2 w-full">
            <label className="text-sm font-semibold text-slate-400">
              Destination
            </label>
            <input
              type="text"
              placeholder="Enter your destination"
              value={destinationInput}
              className="h-12 w-full rounded-xl border border-slate-700 bg-slate-900 pl-2 text-base text-white placeholder:text-slate-400 focus:border-yellow-500 focus:outline-none focus:ring-2 focus:ring-yellow-500/30"
              onChange={(e) => {
                const value = e.target.value;
                setDestinationInput(value);
                // Typing invalidates whatever suggestion was previously
                // selected, same reasoning as the departure field above.
                setDestinationInputCoordinate(null);
                setDestinationInputState(null);
              }}
            />
            {isSearchingDestination && (
              <p className="text-sm text-slate-400">Searching locations...</p>
            )}
            {destinationSuggestions.length > 0 && (
              <div className="flex flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-900">
                {destinationSuggestions.map((suggestion) => (
                  <button
                    key={`${suggestion.label}-${suggestion.coordinate.lat}-${suggestion.coordinate.lng}`}
                    type="button"
                    className="px-3 py-2 text-left text-sm text-slate-200 transition hover:bg-slate-800 active:bg-slate-700"
                    onClick={() => {
                      suppressDestinationSearchRef.current = true;
                      setDestinationInput(suggestion.label);
                      setDestinationInputCoordinate(suggestion.coordinate);
                      setDestinationInputState(suggestion.state);
                      setDestinationSuggestions([]);
                    }}
                  >
                    {suggestion.label}
                  </button>
                ))}
              </div>
            )}
            {destinationGeocodingError && (
              <p className="text-sm text-red-400 mt-1">
                {destinationGeocodingError}
              </p>
            )}
            {journeyDetailsError.destination && (
              <p className="text-sm text-red-400 mt-1">
                {journeyDetailsError.destination}
              </p>
            )}
            {journeyDetails.destination.length > 0 && (
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
            <button
              type="button"
              onClick={addDestination}
              className="btn btn-primary w-full h-12 bg-yellow-500 font-semibold text-black rounded-xl transition active:bg-yellow-600 "
            >
              Confirm Destination
            </button>
          </div>

          {/* Vehicle Type */}
          <div className="flex flex-col gap-2 mt-1 w-full">
            <label className="text-sm font-semibold text-slate-400">
              Vehicle Type
            </label>
            <div className="relative">
              <select
                className="h-12 w-full appearance-none rounded-xl border border-slate-700 bg-slate-900 pl-2 text-base text-white placeholder:text-slate-400 transition focus:border-yellow-500 focus:outline-none"
                value={journeyDetails.vehicleType}
                onChange={(e) =>
                  setJourneyDetails({
                    ...journeyDetails,
                    vehicleType: e.target.value,
                  })
                }
              >
                <option value="">Select Vehicle Type</option>
                {vehicleTypes.map((type) => (
                  <option key={type} value={type.toLowerCase()}>
                    {type}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute pointer-events-none right-3 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" />
              {journeyDetailsError.vehicleType && (
                <p className="text-sm text-red-400 mt-1">
                  {journeyDetailsError.vehicleType}
                </p>
              )}
            </div>
          </div>

          {/* Fuel Type & Fuel level */}
          <div className="flex flex-col gap-2 mt-1 w-full px-2 py-2 bg-slate-800 rounded-xl">
            <label className="text-sm font-semibold text-slate-400">
              Fuel Type
            </label>
            <div className="relative">
              <select
                className="h-12 w-full appearance-none rounded-xl border border-slate-700 bg-slate-900 pl-2 text-base text-white placeholder:text-slate-400 transition focus:border-yellow-500 focus:outline-none"
                value={journeyDetails.fuelType}
                onChange={(e) =>
                  setJourneyDetails({
                    ...journeyDetails,
                    fuelType: e.target.value,
                  })
                }
              >
                <option value="">Select Fuel Type</option>
                {fuelTypes.map((type) => (
                  <option key={type} value={type.toLowerCase()}>
                    {type}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" />
              {journeyDetailsError.fuelType && (
                <p className="text-sm text-red-400 mt-1">
                  {journeyDetailsError.fuelType}
                </p>
              )}
            </div>
            <div className="flex flex-col gap-2 mt-1 w-full">
              <label className="text-sm font-semibold text-slate-400">
                Remaining Range in KM
              </label>
              <input
                type="text"
                placeholder="eg. 150"
                className="h-12 w-full rounded-xl border border-slate-700 bg-slate-900 pl-2 text-base text-white placeholder:text-slate-400 focus:border-yellow-500 focus:outline-none focus:ring-2 focus:ring-yellow-500/30"
                value={journeyDetails.fuelLevel}
                onChange={(e) => {
                  setJourneyDetails({
                    ...journeyDetails,
                    fuelLevel: e.target.value,
                  });
                }}
              />
              {journeyDetailsError.fuelLevel && (
                <p className="text-sm text-red-400">
                  {journeyDetailsError.fuelLevel}
                </p>
              )}
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
          <p className="text-xs text-slate-500 mt-1">
            The NHVR rest rules are identical in Victoria, NSW,
            Queensland, SA, Tasmania, and the ACT (verified against the
            actual seeded rule data, not just assumed), so the exact
            state rarely matters there. Western Australia runs its own,
            genuinely different rules; the Northern Territory has no
            fixed rules of its own at all (see the note below once
            determined).
          </p>
          <div className="grid w-full grid-cols-2 gap-4 mt-1">
            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-slate-400">
                Jurisdiction
                <span className="ml-2 rounded-full bg-slate-700 px-2 py-0.5 text-[10px] font-bold tracking-wide text-slate-300">
                  AUTO
                </span>
              </label>
              <div className="flex h-12 w-full items-center rounded-xl border border-slate-700 bg-slate-800 pl-2 text-base text-white">
                {journeyDetails.jurisdictionCode
                  ? jurisdictionOptions.find(
                      (jurisdiction) =>
                        jurisdiction.code === journeyDetails.jurisdictionCode,
                    )?.name
                  : (
                    <span className="text-slate-400">
                      Determined from your departure and destination
                    </span>
                  )}
              </div>
              {journeyDetails.jurisdictionCode === "NT" && (
                <p className="text-sm text-slate-400 mt-1">
                  The Northern Territory has no fixed hour/rest limits of
                  its own (it uses a general workplace-safety duty
                  instead). This shows the national HVNL figures as a
                  conservative default, not a rule the Territory itself
                  mandates.
                </p>
              )}
              {journeyDetails.jurisdictionCode === "WA" && (
                <p className="text-sm text-slate-400 mt-1">
                  Western Australia never adopted the national HVNL
                  rules, this uses WA&apos;s own separate WorkSafe
                  scheme instead, which has different hour and rest
                  figures from every other state. Applied to the whole
                  trip whenever WA is your departure or any destination,
                  even if the rest of the route is elsewhere.
                </p>
              )}
              {journeyDetailsError.jurisdictionCode && (
                <p className="text-sm text-red-400 mt-1">
                  {journeyDetailsError.jurisdictionCode}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-slate-400">
                Est. Driving Hours
                <span className="ml-2 rounded-full bg-slate-700 px-2 py-0.5 text-[10px] font-bold tracking-wide text-slate-300">
                  AUTO
                </span>
              </label>
              <div className="flex h-12 w-full items-center rounded-xl border border-slate-700 bg-slate-800 pl-2 text-base text-white">
                {isFetchingDrivingHours ? (
                  <span className="text-slate-400">
                    Calculating from your route...
                  </span>
                ) : journeyDetails.estimatedDrivingHours ? (
                  `${journeyDetails.estimatedDrivingHours} hours`
                ) : (
                  <span className="text-slate-400">
                    Determined from your route
                  </span>
                )}
              </div>
              {journeyDetailsError.estimatedDrivingHours && (
                <p className="text-sm text-red-400 mt-1">
                  {journeyDetailsError.estimatedDrivingHours}
                </p>
              )}
            </div>
          </div>

          {/* Departure & Arrival Time */}
          <div className="grid w-full grid-cols-2 gap-7 rounded-xl bg-slate-800 px-2 py-3">
            <div className="flex w-full flex-col gap-3">
              <div className="flex flex-col gap-2">
                <label className="text-sm font-semibold text-slate-400">
                  Departure Date
                </label>
                <input
                  type="date"
                  className="h-12 w-full pr-1 rounded-xl border border-slate-700 bg-slate-900 px-3 text-base text-white placeholder:text-slate-400 focus:border-yellow-500 focus:outline-none focus:ring-2 focus:ring-yellow-500/30"
                  value={journeyDetails.departureDate}
                  onChange={(e) =>
                    setJourneyDetails({
                      ...journeyDetails,
                      departureDate: e.target.value,
                    })
                  }
                />
                {journeyDetailsError.departureDate && (
                  <p className="text-sm text-red-400 mt-1">
                    {journeyDetailsError.departureDate}
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-sm font-semibold text-slate-400">
                  Departure Time
                </label>
                <input
                  type="time"
                  className="h-12 w-full pr-1 rounded-xl border border-slate-700 bg-slate-900 px-3 text-base text-white placeholder:text-slate-400 focus:border-yellow-500 focus:outline-none focus:ring-2 focus:ring-yellow-500/30"
                  value={journeyDetails.departureTime}
                  onChange={(e) =>
                    setJourneyDetails({
                      ...journeyDetails,
                      departureTime: e.target.value,
                    })
                  }
                />
                {journeyDetailsError.departureTime && (
                  <p className="text-sm text-red-400 mt-1">
                    {journeyDetailsError.departureTime}
                  </p>
                )}
              </div>
            </div>

            <div className="flex w-full flex-col gap-3">
              <div className="flex flex-col gap-2">
                <label className="text-sm font-semibold text-slate-400">
                  Arrival Date
                </label>
                <input
                  type="date"
                  className="h-12 w-full pr-1 rounded-xl border border-slate-700 bg-slate-900 px-3 text-base text-white placeholder:text-slate-400 focus:border-yellow-500 focus:outline-none focus:ring-2 focus:ring-yellow-500/30"
                  value={journeyDetails.arrivalDate}
                  onChange={(e) =>
                    setJourneyDetails({
                      ...journeyDetails,
                      arrivalDate: e.target.value,
                    })
                  }
                />
                {journeyDetailsError.arrivalDate && (
                  <p className="text-sm text-red-400 mt-1">
                    {journeyDetailsError.arrivalDate}
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-sm font-semibold text-slate-400">
                  Arrival Time
                </label>
                <input
                  type="time"
                  className="h-12 w-full pr-1 rounded-xl border border-slate-700 bg-slate-900 px-3 text-base text-white placeholder:text-slate-400 focus:border-yellow-500 focus:outline-none focus:ring-2 focus:ring-yellow-500/30"
                  value={journeyDetails.arrivalTime}
                  onChange={(e) =>
                    setJourneyDetails({
                      ...journeyDetails,
                      arrivalTime: e.target.value,
                    })
                  }
                />
                {journeyDetailsError.arrivalTime && (
                  <p className="text-sm text-red-400 mt-1">
                    {journeyDetailsError.arrivalTime}
                  </p>
                )}
              </div>
            </div>
          </div>
          {journeyDetailsError.dateTimeRange && (
            <p className="text-sm text-red-400 mt-1">
              {journeyDetailsError.dateTimeRange}
            </p>
          )}

          {/* Co-Driver: presence/absence is all that actually matters,
              it decides solo vs two_up for the rest-plan calculation
              (a shorter major rest applies once a second driver can take
              over), no name is collected or shown anywhere in the app. */}
          <div className="flex w-full items-center gap-3 mt-1">
            <input
              id="has-co-driver"
              type="checkbox"
              checked={journeyDetails.hasCoDriver}
              className="h-5 w-5 rounded border-slate-700 bg-slate-900 text-yellow-500 focus:ring-yellow-500/30"
              onChange={(e) =>
                setJourneyDetails({
                  ...journeyDetails,
                  hasCoDriver: e.target.checked,
                })
              }
            />
            <label
              htmlFor="has-co-driver"
              className="text-sm font-semibold text-slate-400"
            >
              Travelling with a co-driver
            </label>
          </div>

          {/* Submit Button */}
          <div className="flex w-full flex-col gap-2">
            <button
              className="w-full h-12 bg-yellow-500 font-semibold text-black rounded-xl transition active:bg-yellow-600 disabled:opacity-60 disabled:active:bg-yellow-500"
              type="submit"
              disabled={isLoadingRestPlan}
            >
              {isLoadingRestPlan
                ? "Checking rest requirements..."
                : "Start Journey"}
            </button>
          </div>

          {restPlanError && (
            <p className="w-full text-sm text-red-400 mt-1">{restPlanError}</p>
          )}

          {/* Schedule Analysis: your stated target arrival vs. the
              earliest arrival actually possible once mandatory rest is
              included. Only rendered once departure/arrival date-time
              and a real rest plan all exist, see scheduleAnalysis
              above for exactly what has to be true. */}
          {scheduleAnalysis && (
            <div className="flex w-full flex-col gap-2 mt-1">
              <h5 className="text-lg font-bold">Schedule Analysis</h5>

              {scheduleAnalysis.isTooTight ? (
                <div className="rounded-xl border-2 border-red-500 bg-slate-800 px-3 py-2">
                  <p className="text-sm font-bold text-red-400">
                    Schedule too tight
                  </p>
                  <p className="mt-1 text-sm text-slate-300">
                    Your target arrival doesn&apos;t leave enough time for
                    the mandatory rest breaks below. The earliest you can
                    legally arrive is{" "}
                    <span className="font-semibold text-white">
                      {BREAK_TIME_FORMAT.format(scheduleAnalysis.safeArrival)}
                    </span>
                    .
                  </p>
                </div>
              ) : (
                <div className="rounded-xl border border-emerald-500 bg-slate-800 px-3 py-2">
                  <p className="text-sm font-bold text-emerald-400">
                    Schedule allows for required rest
                  </p>
                  <p className="mt-1 text-sm text-slate-300">
                    Earliest possible arrival, including mandatory rest,
                    is{" "}
                    <span className="font-semibold text-white">
                      {BREAK_TIME_FORMAT.format(scheduleAnalysis.safeArrival)}
                    </span>
                    , before your target.
                  </p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-slate-800 px-3 py-2">
                  <p className="text-xs font-semibold uppercase text-slate-400">
                    Your Target
                  </p>
                  <p className="mt-1 font-semibold text-white">
                    {BREAK_TIME_FORMAT.format(scheduleAnalysis.target)}
                  </p>
                </div>
                <div className="rounded-xl bg-slate-800 px-3 py-2">
                  <p className="text-xs font-semibold uppercase text-slate-400">
                    Safe Arrival
                  </p>
                  <p
                    className={`mt-1 font-semibold ${
                      scheduleAnalysis.isTooTight
                        ? "text-red-400"
                        : "text-emerald-400"
                    }`}
                  >
                    {BREAK_TIME_FORMAT.format(scheduleAnalysis.safeArrival)}
                  </p>
                </div>
                <div className="rounded-xl bg-slate-800 px-3 py-2">
                  <p className="text-xs font-semibold uppercase text-slate-400">
                    Total Drive Time
                  </p>
                  <p className="mt-1 font-semibold text-white">
                    {formatDurationMinutes(scheduleAnalysis.totalDrivingMinutes)}
                  </p>
                </div>
                <div className="rounded-xl bg-slate-800 px-3 py-2">
                  <p className="text-xs font-semibold uppercase text-slate-400">
                    Total Rest Time
                  </p>
                  <p className="mt-1 font-semibold text-white">
                    {formatDurationMinutes(scheduleAnalysis.totalRestMinutes)}
                  </p>
                </div>
              </div>

              {(scheduleAnalysis.shortBreakCount > 0 ||
                scheduleAnalysis.majorRestCount > 0) && (
                <p className="text-sm text-slate-400">
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
              <h5 className="text-lg font-bold">Your Rest Plan</h5>
              {restPlan.length === 0 ? (
                <p className="text-sm text-slate-400">
                  No rest breaks are legally required for a journey this short.
                </p>
              ) : (
                <>
                  {/* A one-line plain-language summary before the list,
                      so the driver knows what they are looking at before
                      reading nine timestamps. */}
                  <p className="text-sm text-slate-400">
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
                          // Every card keeps the same dark bg-slate-800 so
                          // the white text stays readable; the major rest
                          // is distinguished by a yellow border only, not
                          // a lighter fill (a lighter fill under white
                          // text was nearly unreadable, caught by actually
                          // looking at a screenshot, not just the code).
                          className={`rounded-xl bg-slate-800 px-3 py-2 text-sm text-white ${
                            major ? "border-2 border-yellow-500" : ""
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span
                              className={`text-xs font-bold uppercase tracking-wide ${
                                major ? "text-yellow-500" : "text-slate-400"
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
                          <p className="text-xs text-slate-500 mt-1">
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
  // The handle ref limits dragging to the "::" button, so the remove
  // button can still be clicked normally.
  const handleRef = useRef<HTMLButtonElement | null>(null);
  const { isDragging } = useSortable({ id, index, element, handle: handleRef });

  return (
    <li
      ref={setElement}
      className={`flex items-center justify-between gap-3 rounded-xl bg-slate-800 px-3 py-2 text-sm text-white ${
        isDragging ? "opacity-50" : ""
      }`}
    >
      <button
        ref={handleRef}
        type="button"
        className="shrink-0 cursor-grab rounded px-1 text-slate-400 active:cursor-grabbing"
      >
        ::
      </button>
      <span className="flex-1">{destination.label}</span>
      <button
        type="button"
        onClick={() => onRemove(id)}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-red-500 text-lg font-bold leading-none text-white transition active:bg-red-600"
      >
        -
      </button>
    </li>
  );
}
