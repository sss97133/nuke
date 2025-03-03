
import React from 'react';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Heart, Share, MapPin, Clock, Calendar, CheckCircle, Edit, Trash2, Plus
} from 'lucide-react';
import { Vehicle, VehicleActionHandlers } from './types';

interface VehicleCardProps extends VehicleActionHandlers {
  vehicle: Vehicle;
}

const VehicleCard = ({ vehicle, onVerify, onEdit, onRemove }: VehicleCardProps) => {
  return (
    <Card className="overflow-hidden">
      <div className="aspect-video bg-muted relative overflow-hidden">
        <div className="absolute top-2 right-2 flex gap-2">
          <Button variant="outline" size="icon" className="h-8 w-8 bg-background/80 backdrop-blur-sm">
            <Heart className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" className="h-8 w-8 bg-background/80 backdrop-blur-sm">
            <Share className="h-4 w-4" />
          </Button>
        </div>
        <div className="absolute bottom-2 left-2">
          {vehicle.tags.map((tag, i) => (
            <Badge key={i} variant="secondary" className="mr-1 bg-background/80 backdrop-blur-sm">
              {tag}
            </Badge>
          ))}
        </div>
      </div>
      <CardHeader className="pb-2">
        <div className="flex justify-between items-start">
          <div>
            <CardTitle className="text-base">
              {vehicle.year} {vehicle.make} {vehicle.model}
            </CardTitle>
            <div className="flex items-center text-sm text-muted-foreground mt-1">
              <MapPin className="h-3.5 w-3.5 mr-1" />
              <span>{vehicle.location}</span>
            </div>
          </div>
          <div className="font-semibold text-lg">
            ${vehicle.price.toLocaleString()}
          </div>
        </div>
      </CardHeader>
      <CardContent className="pb-3">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="flex items-center">
            <Clock className="h-4 w-4 mr-2 text-muted-foreground" />
            <span>{vehicle.mileage.toLocaleString()} miles</span>
          </div>
          <div className="flex items-center">
            <Calendar className="h-4 w-4 mr-2 text-muted-foreground" />
            <span>Added {vehicle.added}</span>
          </div>
        </div>
      </CardContent>
      <CardFooter className="border-t px-6 py-3 flex flex-wrap gap-2">
        <Button variant="outline" size="sm" className="gap-1" onClick={() => onVerify(vehicle.id)}>
          <CheckCircle className="h-4 w-4" />
          Verify
        </Button>
        <Button variant="outline" size="sm" className="gap-1" onClick={() => onEdit(vehicle.id)}>
          <Edit className="h-4 w-4" />
          Edit
        </Button>
        <Button variant="outline" size="sm" className="gap-1 text-destructive hover:text-destructive" onClick={() => onRemove(vehicle.id)}>
          <Trash2 className="h-4 w-4" />
          Remove
        </Button>
        <Button size="sm" className="gap-1 ml-auto">
          <Plus className="h-4 w-4" />
          Add to Garage
        </Button>
      </CardFooter>
    </Card>
  );
};

export default VehicleCard;
