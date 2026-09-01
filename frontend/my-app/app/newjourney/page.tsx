"use client";

import { ChevronDown } from "lucide-react";
import { useState, useRef } from "react";
import {
  JourneyDetails,
  JourneyDetailsError,
  Destination,
} from "@/types/journeyDetails";
import { DragDropProvider } from "@dnd-kit/react";
import { useSortable } from "@dnd-kit/react/sortable";
import { move } from "@dnd-kit/helpers";

// Keep the storage key in one place so US 1.3 can read the same draft later.
const LOCAL_STORAGE_KEY = "currentJourneyDetails";

export default function NewJourneyPage() {
  // MVP-only option lists. These can be replaced by API data when real
  // address search, vehicle models, and fuel data are ready.
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

  // This input is separate from journeyDetails.destination because the
  // typed value only becomes part of the journey after Add Destination.
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
    });

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
        },
      ],
    });

    setDestinationInput("");
    setJourneyDetailsError((prevErrors) => ({
      ...prevErrors,
      destination: "",
    }));
  };

  // Each validator updates the visible error message and returns a boolean
  // so submit can decide immediately whether saving is allowed.
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

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    const isDestinationValid = validateDestination(journeyDetails.destination);
    const isVehicleTypeValid = validateVehicleType(journeyDetails.vehicleType);
    const isFuelTypeValid = validateFuelType(journeyDetails.fuelType);
    const isFuelLevelValid = validateFuelLevel(journeyDetails.fuelLevel);
    const isCoDriverValid = validateCoDriver(journeyDetails.coDriver);
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
      isDateTimeValid;

    if (!isFormValid) {
      return;
    }

    // Store the validated draft locally so the next journey planning step
    // can reuse it without needing backend storage yet.
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(journeyDetails));
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
              className="w-full h-12 bg-yellow-500 font-semibold text-black rounded-xl transition active:bg-yellow-600"
              type="submit"
            >
              Start Journey
            </button>
          </div>
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
