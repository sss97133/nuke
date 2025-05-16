
import React from "react";
import { DiscoveredVehiclesList } from "./DiscoveredVehiclesList";

export const DiscoveredVehicles = () => {
  return (
    <div className="container py-6">
      <h1 className="text-3xl font-bold mb-6">Discovered Vehicles</h1>
      <DiscoveredVehiclesList />
    </div>
  );
};
