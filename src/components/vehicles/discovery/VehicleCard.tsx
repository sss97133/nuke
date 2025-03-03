
import React from 'react';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Heart, Share, MapPin, Clock, Calendar, Edit, Trash2, CheckCircle
} from 'lucide-react';
import { Vehicle, VehicleActionHandlers } from './types';

interface VehicleCardProps extends VehicleActionHandlers {
  vehicle: Vehicle;
}

const VehicleCard = ({ vehicle, onVerify, onEdit, onRemove }: VehicleCardProps) => {
  // Function to format mileage to k format
  const formatMileage = (miles: number) => {
    return miles >= 1000 ? `${Math.round(miles / 1000)}k` : miles.toString();
  };

  // Function to extract just the number from "X days ago"
  const extractDays = (timeString: string) => {
    const match = timeString.match(/^(\d+)/);
    return match ? match[1] : timeString;
  };

  return (
    <Card className="overflow-hidden">
      <div className="aspect-video bg-muted relative overflow-hidden h-40">
        <div className="absolute top-2 right-2 flex gap-2">
          <Button variant="outline" size="icon" className="h-7 w-7 bg-background/80 backdrop-blur-sm">
            <Heart className="h-3.5 w-3.5" />
          </Button>
          <Button variant="outline" size="icon" className="h-7 w-7 bg-background/80 backdrop-blur-sm">
            <Share className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="absolute bottom-2 left-2 flex flex-wrap gap-1">
          {vehicle.tags.map((tag, i) => (
            <Badge key={i} variant="secondary" className="text-xs bg-background/80 backdrop-blur-sm">
              {tag}
            </Badge>
          ))}
        </div>
        
        {/* Verification status indicator */}
        <div className="absolute top-2 left-2">
          <CheckCircle 
            className={`h-5 w-5 ${vehicle.id % 2 === 0 ? 'text-blue-500' : 'text-gray-400'}`} 
          />
        </div>
      </div>
      <CardHeader className="p-3 pb-0">
        <div className="flex justify-between items-start">
          <div>
            <CardTitle className="text-sm font-medium">
              {vehicle.year} {vehicle.make} {vehicle.model}
            </CardTitle>
            <div className="flex items-center text-xs text-muted-foreground mt-1">
              <MapPin className="h-3 w-3 mr-1" />
              <span>{vehicle.location}</span>
            </div>
          </div>
          <div className="font-semibold text-base">
            ${vehicle.price.toLocaleString()}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-3 pb-1">
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="flex items-center">
            <Clock className="h-3.5 w-3.5 mr-1 text-muted-foreground" />
            <span>{formatMileage(vehicle.mileage)} mi</span>
          </div>
          <div className="flex items-center">
            <Calendar className="h-3.5 w-3.5 mr-1 text-muted-foreground" />
            <span>{extractDays(vehicle.added)}</span>
          </div>
        </div>
      </CardContent>
      <CardFooter className="border-t px-3 py-2 flex flex-wrap gap-1">
        <Button variant="outline" size="sm" className="h-7 text-xs px-2" onClick={() => onVerify(vehicle.id)}>
          <CheckCircle className="h-3.5 w-3.5 mr-1" />
        </Button>
        <Button variant="outline" size="sm" className="h-7 text-xs px-2" onClick={() => onEdit(vehicle.id)}>
          <Edit className="h-3.5 w-3.5 mr-1" />
        </Button>
        <Button variant="outline" size="sm" className="h-7 text-xs px-2 text-destructive hover:text-destructive" onClick={() => onRemove(vehicle.id)}>
          <Trash2 className="h-3.5 w-3.5 mr-1" />
        </Button>
      </CardFooter>
    </Card>
  );
};

export default VehicleCard;
