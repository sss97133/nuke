
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Heart, Share, MapPin, Clock, Calendar, Edit, Trash2, CheckCircle
} from 'lucide-react';
import { Vehicle, VehicleActionHandlers } from './types';
import { VerificationDialog } from './VerificationDialog';

interface VehicleCardProps extends VehicleActionHandlers {
  vehicle: Vehicle;
}

const VehicleCard = ({ vehicle, onVerify, onEdit, onRemove }: VehicleCardProps) => {
  const navigate = useNavigate();
  
  // Function to format mileage to k format
  const formatMileage = (miles: number) => {
    return miles >= 1000 ? `${Math.round(miles / 1000)}k` : miles.toString();
  };

  // Function to extract just the number from "X days ago"
  const extractDays = (timeString: string) => {
    const match = timeString.match(/^(\d+)/);
    return match ? match[1] : timeString;
  };

  const handleCardClick = () => {
    navigate(`/vehicle/${vehicle.id}`);
  };

  return (
    <Card className="overflow-hidden">
      <div 
        className="aspect-video bg-muted relative overflow-hidden h-40 cursor-pointer"
        onClick={handleCardClick}
      >
        <div className="absolute top-2 right-2 flex gap-2">
          <Button variant="outline" size="icon" className="h-7 w-7 bg-background/80 backdrop-blur-sm">
            <Heart className="h-3.5 w-3.5" />
          </Button>
          <Button variant="outline" size="icon" className="h-7 w-7 bg-background/80 backdrop-blur-sm">
            <Share className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="absolute bottom-2 left-2 flex flex-wrap gap-1">
          {vehicle.tags?.map((tag, i) => (
            <Badge key={i} variant="secondary" className="text-xs bg-background/80 backdrop-blur-sm">
              {tag}
            </Badge>
          ))}
        </div>
        
        {/* Status indicators */}
        <div className="absolute top-2 left-2 flex gap-1">
          <CheckCircle 
            className={`h-5 w-5 ${vehicle.condition_rating > 7 ? 'text-green-500' : vehicle.condition_rating > 4 ? 'text-yellow-500' : 'text-red-500'}`} 
          />
          {vehicle.rarity_score > 8 && (
            <Badge variant="secondary" className="text-xs bg-purple-500/80">Rare</Badge>
          )}
        </div>
      </div>
      <CardHeader 
        className="p-3 pb-0 cursor-pointer"
        onClick={handleCardClick}
      >
        <div className="flex justify-between items-start">
          <div>
            <CardTitle className="text-sm font-medium">
              {vehicle.year} {vehicle.make} {vehicle.model}
              {vehicle.trim && <span className="text-muted-foreground"> {vehicle.trim}</span>}
            </CardTitle>
            <div className="flex items-center text-xs text-muted-foreground mt-1">
              <MapPin className="h-3 w-3 mr-1" />
              <span>{vehicle.location}</span>
            </div>
          </div>
          <div className="text-right">
            <div className="font-semibold text-base">
              ${vehicle.market_value?.toLocaleString() || vehicle.price?.toLocaleString()}
            </div>
            {vehicle.price_trend && (
              <div className={`text-xs ${vehicle.price_trend === 'up' ? 'text-green-500' : 'text-red-500'}`}>
                {vehicle.price_trend === 'up' ? '↑' : '↓'} Market trend
              </div>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent 
        className="p-3 pb-1 cursor-pointer"
        onClick={handleCardClick}
      >
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div className="flex items-center" title="Mileage">
            <Clock className="h-3.5 w-3.5 mr-1 text-muted-foreground" />
            <span>{formatMileage(vehicle.mileage)}</span>
          </div>
          <div className="flex items-center" title="Days listed">
            <Calendar className="h-3.5 w-3.5 mr-1 text-muted-foreground" />
            <span>{extractDays(vehicle.added)}</span>
          </div>
          <div className="flex items-center" title="Condition">
            <span className={`px-2 py-0.5 rounded-full text-[10px] ${
              vehicle.condition_rating > 7 ? 'bg-green-100 text-green-700' :
              vehicle.condition_rating > 4 ? 'bg-yellow-100 text-yellow-700' :
              'bg-red-100 text-red-700'
            }`}>
              {vehicle.condition_rating}/10
            </span>
          </div>
        </div>
      </CardContent>
      <CardFooter className="border-t px-3 py-2 flex flex-wrap gap-1">
        <VerificationDialog
          vehicleId={vehicle.id}
          vehicleName={`${vehicle.year} ${vehicle.make} ${vehicle.model}`}
          onComplete={() => onVerify(vehicle.id)}
        >
          <Button variant="outline" size="sm" className="h-7 text-xs px-2">
            <CheckCircle className="h-3.5 w-3.5 mr-1" />
            Verify
          </Button>
        </VerificationDialog>
        
        <Button variant="outline" size="sm" className="h-7 text-xs px-2" onClick={(e) => {
          e.stopPropagation(); // Prevent navigation to detail page
          onEdit(vehicle.id);
        }}>
          <Edit className="h-3.5 w-3.5 mr-1" />
          Edit
        </Button>
        <Button variant="outline" size="sm" className="h-7 text-xs px-2 text-destructive hover:text-destructive" onClick={(e) => {
          e.stopPropagation(); // Prevent navigation to detail page
          onRemove(vehicle.id);
        }}>
          <Trash2 className="h-3.5 w-3.5 mr-1" />
          Remove
        </Button>
      </CardFooter>
    </Card>
  );
};

export default VehicleCard;
