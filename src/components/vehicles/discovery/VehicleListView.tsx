
import React from 'react';
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, Edit, Trash2, ArrowUp, ArrowDown } from 'lucide-react';
import { Vehicle, VehicleActionHandlers } from './types';

interface VehicleListViewProps extends VehicleActionHandlers {
  vehicles: Vehicle[];
  selectedVehicles: number[];
  toggleVehicleSelection: (id: number) => void;
  sortField?: string;
  sortDirection?: 'asc' | 'desc';
}

const VehicleListView = ({ 
  vehicles, 
  selectedVehicles, 
  toggleVehicleSelection,
  onVerify,
  onEdit,
  onRemove,
  sortField,
  sortDirection
}: VehicleListViewProps) => {
  // Helper function to render sort icon
  const renderSortIcon = (field: string) => {
    if (sortField === field) {
      return sortDirection === 'asc' ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />;
    }
    return null;
  };
  
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
    <div className="space-y-2">
      <div className="grid grid-cols-12 gap-4 px-4 py-2 bg-muted font-medium text-xs rounded-md">
        <div className="col-span-1">
          <input 
            type="checkbox"
            className="translate-y-[2px]"
            checked={selectedVehicles.length === vehicles.length && vehicles.length > 0}
            onChange={() => {
              if (selectedVehicles.length === vehicles.length) {
                toggleVehicleSelection(-1); // Special signal to clear all
              } else {
                vehicles.forEach(v => {
                  if (!selectedVehicles.includes(v.id)) {
                    toggleVehicleSelection(v.id);
                  }
                });
              }
            }}
          />
        </div>
        <div className="col-span-2">Preview</div>
        <div className="col-span-2 flex items-center gap-1 cursor-pointer">
          Vehicle {renderSortIcon('model')}
        </div>
        <div className="col-span-1 flex items-center gap-1 cursor-pointer">
          Year {renderSortIcon('year')}
        </div>
        <div className="col-span-2 flex items-center gap-1 cursor-pointer">
          Price {renderSortIcon('price')}
        </div>
        <div className="col-span-1 flex items-center gap-1 cursor-pointer">
          Mileage {renderSortIcon('mileage')}
        </div>
        <div className="col-span-1 flex items-center gap-1 cursor-pointer">
          Added {renderSortIcon('added')}
        </div>
        <div className="col-span-2 text-right">Actions</div>
      </div>
      
      {vehicles.map(vehicle => (
        <Card key={vehicle.id} className="p-2">
          <div className="grid grid-cols-12 gap-4 items-center">
            <div className="col-span-1">
              <input 
                type="checkbox"
                checked={selectedVehicles.includes(vehicle.id)}
                onChange={() => toggleVehicleSelection(vehicle.id)}
              />
            </div>
            <div className="col-span-2">
              <div className="aspect-video w-full h-16 rounded-md bg-muted overflow-hidden relative">
                <div className="absolute bottom-1 left-1">
                  {vehicle.tags.slice(0, 1).map((tag, i) => (
                    <Badge key={i} variant="secondary" className="text-[10px]">
                      {tag}
                    </Badge>
                  ))}
                </div>
                <div className="absolute top-1 left-1">
                  <CheckCircle 
                    className={`h-4 w-4 ${vehicle.id % 2 === 0 ? 'text-blue-500' : 'text-gray-400'}`}
                  />
                </div>
              </div>
            </div>
            <div className="col-span-2">
              <div className="font-medium text-xs">{vehicle.make} {vehicle.model}</div>
              <div className="text-[10px] text-muted-foreground">{vehicle.location}</div>
            </div>
            <div className="col-span-1 text-xs">{vehicle.year}</div>
            <div className="col-span-2 font-semibold text-xs">${vehicle.price.toLocaleString()}</div>
            <div className="col-span-1 text-xs">{formatMileage(vehicle.mileage)} mi</div>
            <div className="col-span-1 text-xs">{extractDays(vehicle.added)}</div>
            <div className="col-span-2 flex justify-end gap-1">
              <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => onVerify(vehicle.id)}>
                <CheckCircle className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => onEdit(vehicle.id)}>
                <Edit className="h-3.5 w-3.5" />
              </Button>
              <Button 
                variant="ghost" 
                size="sm" 
                className="h-7 px-2 text-destructive hover:text-destructive" 
                onClick={() => onRemove(vehicle.id)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
};

export default VehicleListView;
