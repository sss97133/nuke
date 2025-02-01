import { useState } from "react";
import { VehicleList } from "./VehicleList";
import { VehicleForm } from "./VehicleForm";
import { Button } from "@/components/ui/button";

export const VehicleManagement = () => {
  const [showForm, setShowForm] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-sm font-mono text-[#283845] tracking-tight uppercase">Vehicle Registry</h2>
          <p className="text-xs text-[#666] font-mono mt-1">Asset Documentation System</p>
        </div>
        <Button
          onClick={() => setShowForm(!showForm)}
          className="bg-[#283845] hover:bg-[#1a2830] text-white font-mono text-sm"
        >
          {showForm ? "View Registry" : "Register Vehicle"}
        </Button>
      </div>
      {showForm ? <VehicleForm /> : <VehicleList />}
    </div>
  );
};