
import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Garage } from "./types";

interface GarageCardProps {
  garage: Garage;
  onSelect: (garageId: string) => void;
}

export const GarageCard: React.FC<GarageCardProps> = ({ garage, onSelect }) => {
  return (
    <Card className="hover:bg-accent transition-colors">
      <CardHeader>
        <CardTitle>{garage.name}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground mb-4">
          Role: {garage.garage_members[0]?.role || 'Member'}
        </p>
        <Button 
          className="w-full"
          onClick={() => onSelect(garage.id)}
        >
          Select Garage
        </Button>
      </CardContent>
    </Card>
  );
};
