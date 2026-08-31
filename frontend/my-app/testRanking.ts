import {
  applyFuelRanking,
  applyNightTimeRanking,
  RankedStop,
} from "./utils/rankStops";

const stop: RankedStop = {
  id: "1",
  name: "Test Rest Area",
  score: 50,
  rankingReason: "",
  hasLighting: true,
  hasHeavyVehicleParking: true,
  fuelTypes: ["Diesel", "Petrol"],
};

const nightResult = applyNightTimeRanking(stop, true);

console.log("Night result:");
console.log(nightResult);

const fuelResult = applyFuelRanking(
  stop,
  true,
  "Diesel"
);

console.log("Fuel result:");
console.log(fuelResult);