
import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Car } from "lucide-react";

interface VehicleCardProps {
  title: string;
  price: string;
  location: string;
  days: number;
  bids: number;
  imageUrl?: string;
}

const VehicleCard: React.FC<VehicleCardProps> = ({
  title,
  price,
  location,
  days,
  bids,
  imageUrl,
}) => {
  return (
    <Card className="overflow-hidden">
      <div className="h-40 bg-muted flex items-center justify-center">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={title}
            className="h-full w-full object-cover"
          />
        ) : (
          <Car className="h-12 w-12 text-muted-foreground" />
        )}
      </div>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex justify-between items-center">
          <span className="font-semibold">{price}</span>
          <span className="text-sm text-muted-foreground">{location}</span>
        </div>
        <div className="mt-3 text-sm text-muted-foreground">
          <span>{days} days left</span>
          <span className="mx-2">•</span>
          <span>{bids} bids</span>
        </div>
        <Button variant="outline" className="w-full mt-4">
          View Details
        </Button>
      </CardContent>
    </Card>
  );
};

export default VehicleCard;
