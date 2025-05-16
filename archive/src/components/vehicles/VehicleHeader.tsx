import { Button } from "@/components/ui/button";
import { CardHeader, CardTitle } from "@/components/ui/card";
import type { Vehicle } from "@/types/inventory";
import { useNavigate } from "react-router-dom";

interface VehicleHeaderProps {
  vehicle: Vehicle;
}

export const VehicleHeader = ({ vehicle }: VehicleHeaderProps) => {
  const navigate = useNavigate();
  
  return (
    <>
      <div className="mb-6">
        <Button
          onClick={() => navigate("/")}
          variant="outline"
          className="font-mono text-sm"
        >
          ← Back to Vehicle List
        </Button>
      </div>
      <CardHeader>
        <CardTitle className="text-2xl font-mono text-[#283845]">
          {vehicle.make} {vehicle.model} ({vehicle.year})
        </CardTitle>
      </CardHeader>
    </>
  );
};