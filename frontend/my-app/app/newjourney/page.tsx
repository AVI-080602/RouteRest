"use client";

import { Settings, ChevronDown } from "lucide-react";
import { useState, useRef } from "react";
import {
  JourneyDetails,
  JourneyDetailsError,
  Destination,
  RestBreak,
} from "@/types/journeyDetails";
import { DragDropProvider } from "@dnd-kit/react";
import { useSortable } from "@dnd-kit/react/sortable";
import { move } from "@dnd-kit/helpers";

// Local Storage key for journey details
const LOCAL_STORAGE_KEY = "currentJourneyDetails";

// Falls back to localhost for local development; overridable via an env
// var so this does not need editing when the backend is deployed elsewhere.
const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

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

/** True for the one major (7h solo / 5h two-up) daily rest, false for the
 * short 15/30/60-minute breaks. The backend's reason text is the only
 * signal available here; see rest_plan.py, every major-rest reason
 * always contains this phrase. */
const isMajorRest = (reason: string) => reason.toLowerCase().includes("major rest");

/** Turns a start/end pair into a plain duration a driver can read at a
 * glance ("15 min", "1 hr 30 min", "7 hr") instead of making them
 * subtract two timestamps themselves. */
const formatBreakDuration = (start: string, end: string) => {
  const totalMinutes = Math.round(
    (new Date(end).getTime() - new Date(start).getTime()) / 60000,
  );
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} min`;
  if (minutes === 0) return `${hours} hr`;
  return `${hours} hr ${minutes} min`;
};

export default function NewJourneyPage() {
  // Mock data for destination options, vehicle types, and fuel types
  const destinationOptions = [
    "Sydney CBD, NSW 2000, Australia",
    "Melbourne CBD, VIC 3000, Australia",
    "Brisbane CBD, QLD 4000, Australia",
    "Adelaide CBD, SA 5000, Australia",
    "Perth CBD, WA 6000, Australia",
    "Hobart CBD, TAS 7000, Australia",
    "Darwin CBD, NT 0800, Australia",
    "Canberra City, ACT 2601, Australia",
    "Geelong VIC 3220, Australia",
    "Ballarat VIC 3350, Australia",
  ];
  const vehicleTypes: string[] = [
    "B-Double",
    "Rigid Truck",
    "Prime Mover",
    "Road Train",
  ];

  const fuelTypes: string[] = ["Diesel", "Electric"];
  const mostCoDriverLength = 20;

  // The six jurisdictions the Heavy Vehicle National Law actually applies
  // in, matching the rows seeded into the fatigue_rule table (see
  // backend/db/seed_fatigue_rules.sql). WA and NT are deliberately not
  // listed: the backend has no rules for them and would reject the
  // request, so there is no point offering them here.
  const jurisdictionOptions: { code: string; name: string }[] = [
    { code: "VIC", name: "Victoria" },
    { code: "NSW", name: "New South Wales" },
    { code: "QLD", name: "Queensland" },
    { code: "SA", name: "South Australia" },
    { code: "TAS", name: "Tasmania" },
    { code: "ACT", name: "Australian Capital Territory" },
  ];

  const [destinationInput, setDestinationInput] = useState<string>("");

  const [journeyDetails, setJourneyDetails] = useState<JourneyDetails>({
    destination: [],
    vehicleType: "",
    fuelType: "",
    fuelLevel: "",
    departureDate: "",
    departureTime: "",
    arrivalDate: "",
    arrivalTime: "",
    coDriver: "",
    jurisdictionCode: "",
    estimatedDrivingHours: "",
  });

  const [journeyDetailsError, setJourneyDetailsError] =
    useState<JourneyDetailsError>({
      destination: "",
      vehicleType: "",
      fuelType: "",
      fuelLevel: "",
      departureDate: "",
      departureTime: "",
      arrivalDate: "",
      arrivalTime: "",
      dateTimeRange: "",
      coDriver: "",
      jurisdictionCode: "",
      estimatedDrivingHours: "",
    });

  // US 1.3: the computed rest plan, once the backend has responded.
  // null means "not requested yet", an empty array is a real, valid
  // answer meaning no rest is legally required for this journey.
  const [restPlan, setRestPlan] = useState<RestBreak[] | null>(null);
  const [isLoadingRestPlan, setIsLoadingRestPlan] = useState(false);
  const [restPlanError, setRestPlanError] = useState<string>("");

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
          id: crypto.randomUUID(), // Generate a unique ID for the destination
          label: destination,
        },
      ],
    });

    setDestinationInput("");
    setJourneyDetailsError((prevErrors) => ({
      ...prevErrors,
      destination: "",
    }));
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
    const maxFuelLevel = 5000; // Maximum fuel level in liters

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

  const validateCoDriver = (coDriver: string) => {
    if (coDriver && coDriver.length > mostCoDriverLength) {
      setJourneyDetailsError((prevErrors) => ({
        ...prevErrors,
        coDriver: `Co-driver name must be at most ${mostCoDriverLength} characters long.`,
      }));
      return false;
    }

    setJourneyDetailsError((prevErrors) => ({
      ...prevErrors,
      coDriver: "",
    }));
    return true;
  };

  const validateJurisdictionCode = (jurisdictionCode: string) => {
    if (!jurisdictionCode) {
      setJourneyDetailsError((prevErrors) => ({
        ...prevErrors,
        jurisdictionCode: "Jurisdiction is required to check rest rules.",
      }));
      return false;
    }

    setJourneyDetailsError((prevErrors) => ({
      ...prevErrors,
      jurisdictionCode: "",
    }));
    return true;
  };

  const validateEstimatedDrivingHours = (value: string) => {
    const trimmedValue = value.trim();
    // Matches the backend's own sanity ceiling (main.py's RestPlanRequest),
    // which is deliberately generous rather than a real limit. It is NOT
    // the boundary of what the rest-plan calculation actually checks:
    // the algorithm only ever applies the NHVR 24-hour daily rule (see
    // rest_plan.py's module docstring), so a journey entered here well
    // beyond 24 hours gets a plan that repeats the daily cycle, without
    // evaluating the separate 7-day/14-day NHVR limits at all.
    const maxDrivingHours = 336;

    if (!trimmedValue) {
      setJourneyDetailsError((prevErrors) => ({
        ...prevErrors,
        estimatedDrivingHours: "Estimated driving hours is required.",
      }));
      return false;
    }

    const parsedHours = Number(trimmedValue);
    if (Number.isNaN(parsedHours) || parsedHours <= 0) {
      setJourneyDetailsError((prevErrors) => ({
        ...prevErrors,
        estimatedDrivingHours: "Enter a positive number of hours.",
      }));
      return false;
    }

    if (parsedHours > maxDrivingHours) {
      setJourneyDetailsError((prevErrors) => ({
        ...prevErrors,
        estimatedDrivingHours: `Estimated driving hours cannot exceed ${maxDrivingHours}.`,
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
  const fetchRestPlan = async (details: JourneyDetails) => {
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
          // A co-driver's name being present is what actually changes
          // which NHVR limits apply (a shorter major rest is allowed
          // once a second driver can take over), so that presence, not
          // anything else about the co-driver, decides the configuration.
          configuration: details.coDriver.trim() ? "two_up" : "solo",
          total_driving_hours: Number(details.estimatedDrivingHours),
        }),
      });
    } catch {
      setRestPlanError("Could not reach the rest plan service. Check that the backend is running.");
      setIsLoadingRestPlan(false);
      return;
    }

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setRestPlanError(body?.detail ?? `Request failed with status ${response.status}`);
      setIsLoadingRestPlan(false);
      return;
    }

    const plan: RestBreak[] = await response.json();
    setRestPlan(plan);
    setIsLoadingRestPlan(false);
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

    const isDestinationValid = validateDestination(journeyDetails.destination);
    const isVehicleTypeValid = validateVehicleType(journeyDetails.vehicleType);
    const isFuelTypeValid = validateFuelType(journeyDetails.fuelType);
    const isFuelLevelValid = validateFuelLevel(journeyDetails.fuelLevel);
    const isCoDriverValid = validateCoDriver(journeyDetails.coDriver);
    const isJurisdictionValid = validateJurisdictionCode(journeyDetails.jurisdictionCode);
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
      isDestinationValid &&
      isVehicleTypeValid &&
      isFuelTypeValid &&
      isFuelLevelValid &&
      isCoDriverValid &&
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

    await fetchRestPlan(journeyDetails);
  };

  return (
    <div className="container mx-auto px-4">
      <form onSubmit={handleSubmit}>
        <div className="flex flex-col items-center justify-between gap-2 min-h-screen">
          <div className="flex items-center justify-between w-full mt-4">
            {/* Top */}
            <h5 className="text-lg font-bold ">New Journey</h5>
          </div>

          {/* Destination */}
          <div className="flex flex-col gap-2 w-full">
            <label className="text-sm font-semibold text-slate-400">
              Destination
            </label>
            <input
              type="text"
              list="destination-options"
              placeholder="Enter your destination"
              value={destinationInput}
              className="h-12 w-full rounded-xl border border-slate-700 bg-slate-900 pl-2 text-base text-white placeholder:text-slate-400 focus:border-yellow-500 focus:outline-none focus:ring-2 focus:ring-yellow-500/30"
              onChange={(e) => setDestinationInput(e.target.value)}
            />
            <datalist id="destination-options">
              {destinationOptions.map((destination) => (
                <option key={destination} value={destination} />
              ))}
            </datalist>
            {journeyDetailsError.destination && (
              <p className="text-sm text-red-400 mt-1">
                {journeyDetailsError.destination}
              </p>
            )}
            {journeyDetails.destination.length > 0 && (
              <DragDropProvider
                onDragEnd={(event) => {
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
              + Add Destination
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
                Fuel Level
              </label>
              <input
                type="text"
                placeholder="Enter fuel level"
                className="h-12 w-full rounded-xl border border-slate-700 bg-slate-900 pl-2 text-base text-white placeholder:text-slate-400 focus:border-yellow-500 focus:outline-none focus:ring-2 focus:ring-yellow-500/30"
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
          {/* Stand-ins for real route data (see the comment on
              JourneyDetails.jurisdictionCode): until routing is wired
              up, the driver states these directly so the rest-plan
              calculation has something real to work from. */}
          <div className="grid w-full grid-cols-2 gap-4 mt-1">
            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-slate-400">
                Jurisdiction
              </label>
              <div className="relative">
                <select
                  className="h-12 w-full appearance-none rounded-xl border border-slate-700 bg-slate-900 pl-2 text-base text-white placeholder:text-slate-400 transition focus:border-yellow-500 focus:outline-none"
                  onChange={(e) =>
                    setJourneyDetails({
                      ...journeyDetails,
                      jurisdictionCode: e.target.value,
                    })
                  }
                >
                  <option value="">Select Jurisdiction</option>
                  {jurisdictionOptions.map((jurisdiction) => (
                    <option key={jurisdiction.code} value={jurisdiction.code}>
                      {jurisdiction.name}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute pointer-events-none right-3 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" />
              </div>
              {journeyDetailsError.jurisdictionCode && (
                <p className="text-sm text-red-400 mt-1">
                  {journeyDetailsError.jurisdictionCode}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-slate-400">
                Est. Driving Hours
              </label>
              <input
                type="text"
                placeholder="e.g. 8"
                className="h-12 w-full rounded-xl border border-slate-700 bg-slate-900 pl-2 text-base text-white placeholder:text-slate-400 focus:border-yellow-500 focus:outline-none focus:ring-2 focus:ring-yellow-500/30"
                onChange={(e) =>
                  setJourneyDetails({
                    ...journeyDetails,
                    estimatedDrivingHours: e.target.value,
                  })
                }
              />
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

          {/* CoDriver (Optional) */}
          <div className="flex w-full flex-col gap-2 mt-1">
            <label className="text-sm font-semibold text-slate-400">
              Co-Driver (Optional)
            </label>
            <input
              type="text"
              placeholder="Enter co-driver's name"
              className="h-12 w-full rounded-xl border border-slate-700 bg-slate-900 pl-2 text-base text-white placeholder:text-slate-400 focus:border-yellow-500 focus:outline-none focus:ring-2 focus:ring-yellow-500/30"
              onChange={(e) =>
                setJourneyDetails({
                  ...journeyDetails,
                  coDriver: e.target.value,
                })
              }
            />
            {journeyDetailsError.coDriver && (
              <p className="text-sm text-red-400 mt-1">
                {journeyDetailsError.coDriver}
              </p>
            )}
          </div>

          {/* Submit Button */}
          <div className="flex w-full flex-col gap-2">
            <button
              className="w-full h-12 bg-yellow-500 font-semibold text-black rounded-xl transition active:bg-yellow-600 disabled:opacity-60 disabled:active:bg-yellow-500"
              type="submit"
              disabled={isLoadingRestPlan}
            >
              {isLoadingRestPlan ? "Checking rest requirements..." : "Start Journey"}
            </button>
          </div>

          {restPlanError && (
            <p className="w-full text-sm text-red-400 mt-1">{restPlanError}</p>
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
                  No rest breaks are legally required for a journey this
                  short.
                </p>
              ) : (
                <>
                  {/* A one-line plain-language summary before the list,
                      so the driver knows what they are looking at before
                      reading nine timestamps. */}
                  <p className="text-sm text-slate-400">
                    {restPlan.filter((b) => !isMajorRest(b.reason)).length} short
                    break{restPlan.filter((b) => !isMajorRest(b.reason)).length === 1 ? "" : "s"}{" "}
                    and {restPlan.filter((b) => isMajorRest(b.reason)).length} major
                    rest{restPlan.filter((b) => isMajorRest(b.reason)).length === 1 ? "" : "s"} planned.
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
                              {formatBreakDuration(restBreak.start, restBreak.end)}
                            </span>
                          </div>
                          <p className="mt-1">
                            {BREAK_TIME_FORMAT.format(new Date(restBreak.start))}
                          </p>
                          {/* The regulation reference stays visible but
                              secondary, useful detail, not the headline. */}
                          <p className="text-xs text-slate-500 mt-1">{restBreak.reason}</p>
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
  const [element, setElement] = useState<Element | null>(null);
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
