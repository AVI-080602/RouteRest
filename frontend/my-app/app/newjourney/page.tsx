"use client";

import { Settings, ChevronDown } from "lucide-react";
import { useState } from "react";
import { JourneyDetails, JourneyDetailsError } from "@/types/journeyDetails";

export default function NewJourneyPage() {
  const vehicleTypes: string[] = [
    "B-Double",
    "Rigid Truck",
    "Prime Mover",
    "Road Train",
  ];
  const fuelTypes: string[] = ["Diesel", "Electric"];

  const [journeyDetails, setJourneyDetails] = useState<JourneyDetails>({
    destination: [],
    vehicleType: "",
    fuelType: "",
    fuelLevel: 0,
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
      coDriver: "",
    });

  const validateVehicleType = (vehicleType: string) => {
    if (!vehicleType) {
      setJourneyDetailsError((prevErrors) => ({
        ...prevErrors,
        vehicleType: "Vehicle type is required.",
      }));
    } else {
      setJourneyDetailsError((prevErrors) => ({
        ...prevErrors,
        vehicleType: "",
      }));

    }
  }

  const validateFuelType = (fuelType: string) => {
    if (!fuelType) {
      setJourneyDetailsError((prevErrors) => ({
        ...prevErrors,
        fuelType: "Fuel type is required.",
      }));
    } else {
      setJourneyDetailsError((prevErrors) => ({
        ...prevErrors,
        fuelType: "",
      }));
    }
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    validateVehicleType(journeyDetails.vehicleType);
    validateFuelType(journeyDetails.fuelType);
    console.log("Journey Details:", journeyDetails);
  };

  return (
    <div className="container mx-auto px-4">
      <form onSubmit={handleSubmit}>
        <div className="flex flex-col items-center justify-between gap-2 min-h-screen">
          <div className="flex items-center justify-between w-full mt-4">
            {/* Top */}
            <h5 className="text-lg font-bold ">New Journey</h5>
            <button>
              <Settings className="h-5 w-5" />
            </button>
          </div>

          {/* Destination */}
          <div className="flex flex-col gap-2 w-full">
            <label className="text-sm font-semibold text-slate-400">
              Destination
            </label>
            <input
              type="text"
              placeholder="Enter your destination"
              className="h-12 w-full rounded-xl border border-slate-700 bg-slate-900 pl-2 text-md text-white placeholder:text-slate-400 focus:border-yellow-500 focus:outline-none focus:ring-2 focus:ring-yellow-500/30"
              onChange={(e) =>
                setJourneyDetails({
                  ...journeyDetails,
                  destination: [e.target.value],
                })
              }
            />
            <button className="btn btn-primary w-full h-12 bg-yellow-500 font-semibold text-black rounded-xl transition active:bg-yellow-600 ">
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
                className="h-12 w-full appearance-none rounded-xl border border-slate-700 bg-slate-900 pl-2 text-md text-white placeholder:text-slate-400 transition focus:border-yellow-500 focus:outline-none"
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
                className="h-12 w-full appearance-none rounded-xl border border-slate-700 bg-slate-900 pl-2 text-md text-white placeholder:text-slate-400 transition focus:border-yellow-500 focus:outline-none"
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
                type="number"
                placeholder="Enter your fuel level"
                className="h-12 w-full rounded-xl border border-slate-700 bg-slate-900 pl-2 text-md text-white placeholder:text-slate-400 focus:border-yellow-500 focus:outline-none focus:ring-2 focus:ring-yellow-500/30"
                pattern="[0-9]*"
                onChange={(e) =>
                  setJourneyDetails({
                    ...journeyDetails,
                    fuelLevel: Number(e.target.value),
                  })
                }
              />
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
              </div>
            </div>
          </div>

          {/* CoDriver (Optional) */}
          <div className="flex w-full flex-col gap-2 mt-1">
            <label className="text-sm font-semibold text-slate-400">
              Co-Driver (Optional)
            </label>
            <input
              type="text"
              placeholder="Enter co-driver's name"
              className="h-12 w-full rounded-xl border border-slate-700 bg-slate-900 pl-2 text-md text-white placeholder:text-slate-400 focus:border-yellow-500 focus:outline-none focus:ring-2 focus:ring-yellow-500/30"
              onChange={(e) =>
                setJourneyDetails({
                  ...journeyDetails,
                  coDriver: e.target.value,
                })
              }
            />
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
