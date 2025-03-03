
import React from 'react';
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { CheckCircle, Edit, Trash2, ArrowUp, ArrowDown } from 'lucide-react';
import { Vehicle, VehicleActionHandlers } from './types';

interface VehicleTableProps extends VehicleActionHandlers {
  vehicles: Vehicle[];
  selectedVehicles: number[];
  toggleVehicleSelection: (id: number) => void;
  sortField?: string;
  sortDirection?: 'asc' | 'desc';
}

const VehicleTable = ({ 
  vehicles, 
  selectedVehicles, 
  toggleVehicleSelection,
  onVerify,
  onEdit,
  onRemove,
  sortField,
  sortDirection
}: VehicleTableProps) => {
  // Helper function to render sort icon
  const renderSortIcon = (field: string) => {
    if (sortField === field) {
      return sortDirection === 'asc' ? <ArrowUp className="h-4 w-4 ml-1" /> : <ArrowDown className="h-4 w-4 ml-1" />;
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
    <Card>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[30px]">
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
            </TableHead>
            <TableHead className="cursor-pointer">
              <div className="flex items-center">
                Vehicle {renderSortIcon('make')}
              </div>
            </TableHead>
            <TableHead className="cursor-pointer">
              <div className="flex items-center">
                Year {renderSortIcon('year')}
              </div>
            </TableHead>
            <TableHead className="cursor-pointer">
              <div className="flex items-center">
                Location {renderSortIcon('location')}
              </div>
            </TableHead>
            <TableHead className="cursor-pointer">
              <div className="flex items-center">
                Price {renderSortIcon('price')}
              </div>
            </TableHead>
            <TableHead className="cursor-pointer">
              <div className="flex items-center">
                Mileage {renderSortIcon('mileage')}
              </div>
            </TableHead>
            <TableHead className="cursor-pointer">
              <div className="flex items-center">
                Added {renderSortIcon('added')}
              </div>
            </TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {vehicles.map((vehicle) => (
            <TableRow key={vehicle.id}>
              <TableCell>
                <input 
                  type="checkbox"
                  checked={selectedVehicles.includes(vehicle.id)}
                  onChange={() => toggleVehicleSelection(vehicle.id)}
                />
              </TableCell>
              <TableCell className="font-medium">
                {vehicle.make} {vehicle.model}
              </TableCell>
              <TableCell>{vehicle.year}</TableCell>
              <TableCell>{vehicle.location}</TableCell>
              <TableCell>${vehicle.price.toLocaleString()}</TableCell>
              <TableCell>{formatMileage(vehicle.mileage)}</TableCell>
              <TableCell>{extractDays(vehicle.added)}</TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="icon" onClick={() => onVerify(vehicle.id)} title="Verify">
                    <CheckCircle className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => onEdit(vehicle.id)} title="Edit">
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => onRemove(vehicle.id)} title="Remove">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
};

export default VehicleTable;
