
import React, { useState } from 'react';
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Vehicle } from '@/components/vehicles/discovery/types';
import { Calendar, Clock, MapPin, Star, Car } from 'lucide-react';

interface VehicleDetailHeaderProps {
  vehicle: Vehicle;
}

const VehicleDetailHeader: React.FC<VehicleDetailHeaderProps> = ({ vehicle }) => {
  const [imageError, setImageError] = useState(false);
  
  // Determine the image URL to use
  const imageUrl = !imageError ? (vehicle.image_url || vehicle.image) : null;

  return (
    <Card className="overflow-hidden">
      <div className="relative h-40 sm:h-48 md:h-64 bg-muted">
        {imageUrl ? (
          <div 
            className="w-full h-full bg-center bg-cover" 
            style={{ backgroundImage: `url(${imageUrl})` }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gray-100 dark:bg-gray-800">
            <Car className="h-16 w-16 text-gray-400" />
            <span className="sr-only">{vehicle.year} {vehicle.make} {vehicle.model}</span>
          </div>
        )}
        
        <div className="absolute bottom-4 left-4 flex flex-wrap gap-2">
          {vehicle.tags?.map((tag, index) => (
            <Badge key={index} variant="secondary" className="text-xs">
              {tag}
            </Badge>
          ))}
        </div>
      </div>

      <CardContent className="p-4 md:p-6">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
          <div>
            <h1 className="text-xl md:text-3xl font-bold mb-2">
              {vehicle.year} {vehicle.make} {vehicle.model}
              {vehicle.trim && ` ${vehicle.trim}`}
            </h1>
            <div className="flex items-center text-muted-foreground mb-2">
              <MapPin className="h-4 w-4 mr-2" />
              <span>{vehicle.location || 'Location not specified'}</span>
            </div>
            <div className="flex flex-wrap gap-3 md:gap-4 text-xs md:text-sm">
              <div className="flex items-center">
                <Clock className="h-3 w-3 md:h-4 md:w-4 mr-1 md:mr-2 text-muted-foreground" />
                <span>{(vehicle.mileage || 0).toLocaleString()} miles</span>
              </div>
              <div className="flex items-center">
                <Calendar className="h-3 w-3 md:h-4 md:w-4 mr-1 md:mr-2 text-muted-foreground" />
                <span>Added {vehicle.added || 'recently'}</span>
              </div>
              <div className="flex items-center">
                <Star className="h-3 w-3 md:h-4 md:w-4 mr-1 md:mr-2 text-muted-foreground" />
                <span>Condition: {vehicle.condition_rating || '?'}/10</span>
              </div>
            </div>
          </div>
          
          <div className="text-left md:text-right mt-2 md:mt-0">
            {vehicle.price ? (
              <>
                <div className="text-2xl md:text-3xl font-bold">
                  ${(vehicle.price || 0).toLocaleString()}
                </div>
                <div className={`text-xs md:text-sm ${
                  vehicle.price_trend === 'up' ? 'text-green-500' : 
                  vehicle.price_trend === 'down' ? 'text-red-500' : 
                  'text-muted-foreground'
                }`}>
                  {vehicle.price_trend === 'up' ? '↑' : 
                   vehicle.price_trend === 'down' ? '↓' : '→'} 
                  Market value: ${(vehicle.market_value || 0).toLocaleString()}
                </div>
              </>
            ) : (
              <div className="text-2xl md:text-3xl font-bold text-muted-foreground">
                Price not listed
              </div>
            )}
          </div>
        </div>
        
        <Separator className="my-4 md:my-6" />
        
        <div className="flex flex-col sm:flex-row gap-3">
          <Button className="w-full sm:w-auto" title="Add this vehicle to your personal collection">
            Add to Collection
          </Button>
          <Button variant="outline" className="w-full sm:w-auto">
            Contact Owner
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default VehicleDetailHeader;
