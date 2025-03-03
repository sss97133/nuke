
import React from 'react';
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, Edit, Trash2, Plus, ArrowUp, ArrowDown } from 'lucide-react';
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
  
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-12 gap-4 px-4 py-2 bg-muted font-medium text-sm rounded-md">
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
        <Card key={vehicle.id} className="p-3">
          <div className="grid grid-cols-12 gap-4 items-center">
            <div className="col-span-1">
              <input 
                type="checkbox"
                checked={selectedVehicles.includes(vehicle.id)}
                onChange={() => toggleVehicleSelection(vehicle.id)}
              />
            </div>
            <div className="col-span-2">
              <div className="aspect-[4/3] rounded-md bg-muted overflow-hidden relative">
                <div className="absolute bottom-1 left-1">
                  {vehicle.tags.slice(0, 1).map((tag, i) => (
                    <Badge key={i} variant="secondary" className="text-xs">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
            <div className="col-span-2">
              <div className="font-medium">{vehicle.make} {vehicle.model}</div>
              <div className="text-xs text-muted-foreground">{vehicle.location}</div>
            </div>
            <div className="col-span-1">{vehicle.year}</div>
            <div className="col-span-2 font-semibold">${vehicle.price.toLocaleString()}</div>
            <div className="col-span-1">{vehicle.mileage.toLocaleString()} mi</div>
            <div className="col-span-1">{vehicle.added}</div>
            <div className="col-span-2 flex justify-end gap-1">
              <Button variant="ghost" size="sm" className="h-8 gap-1" onClick={() => onVerify(vehicle.id)}>
                <CheckCircle className="h-4 w-4" />
                Verify
              </Button>
              <Button variant="ghost" size="sm" className="h-8 gap-1" onClick={() => onEdit(vehicle.id)}>
                <Edit className="h-4 w-4" />
                Edit
              </Button>
              <Button 
                variant="ghost" 
                size="sm" 
                className="h-8 gap-1 text-destructive hover:text-destructive" 
                onClick={() => onRemove(vehicle.id)}
              >
                <Trash2 className="h-4 w-4" />
                Remove
              </Button>
              <Button variant="outline" size="sm" className="h-8 gap-1 ml-1">
                <Plus className="h-4 w-4" />
                Add
              </Button>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
};

export default VehicleListView;
