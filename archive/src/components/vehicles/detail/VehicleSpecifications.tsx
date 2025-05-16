
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Vehicle } from '@/components/vehicles/discovery/types';

interface VehicleSpecificationsProps {
  vehicle: Vehicle;
}

const VehicleSpecifications: React.FC<VehicleSpecificationsProps> = ({ vehicle }) => {
  const specSections = [
    {
      title: "Core Specifications",
      specs: [
        { label: "Make", value: vehicle.make },
        { label: "Model", value: vehicle.model },
        { label: "Year", value: vehicle.year },
        { label: "Body Type", value: vehicle.body_type || "N/A" },
        { label: "Trim", value: vehicle.trim || "N/A" },
        { label: "Mileage", value: `${vehicle.mileage.toLocaleString()} miles` },
      ]
    },
    {
      title: "Drivetrain",
      specs: [
        { label: "Engine Type", value: vehicle.engine_type || "N/A" },
        { label: "Transmission", value: vehicle.transmission || "N/A" },
        { label: "Drivetrain", value: vehicle.drivetrain || "N/A" },
      ]
    },
    {
      title: "Condition",
      specs: [
        { label: "Condition Rating", value: `${vehicle.condition_rating}/10` },
        { label: "Restoration Status", value: vehicle.restoration_status || "N/A" },
      ]
    },
    {
      title: "Classification",
      specs: [
        { label: "Vehicle Type", value: vehicle.vehicle_type },
        { label: "Era", value: vehicle.era || "N/A" },
        { label: "Special Edition", value: vehicle.special_edition ? "Yes" : "No" },
        { label: "Rarity Score", value: vehicle.rarity_score ? `${vehicle.rarity_score}/10` : "N/A" },
      ]
    }
  ];

  return (
    <Card className="h-full sticky top-4">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg">Vehicle Specifications</CardTitle>
      </CardHeader>
      <CardContent className="text-xs space-y-4">
        {specSections.map((section, index) => (
          <div key={index}>
            <h3 className="font-medium text-sm mb-2">{section.title}</h3>
            <div className="grid grid-cols-2 gap-2">
              {section.specs.map((spec, specIndex) => (
                <div key={specIndex} className="space-y-0.5">
                  <p className="text-xs text-muted-foreground">{spec.label}</p>
                  <p className="font-medium text-xs">{spec.value}</p>
                </div>
              ))}
            </div>
            {index < specSections.length - 1 && <Separator className="mt-3" />}
          </div>
        ))}
      </CardContent>
    </Card>
  );
};

export default VehicleSpecifications;
