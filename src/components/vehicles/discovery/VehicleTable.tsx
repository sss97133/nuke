
import React from 'react';
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { CheckCircle, Edit, Trash2 } from 'lucide-react';
import { Vehicle, VehicleActionHandlers } from './types';

interface VehicleTableProps extends VehicleActionHandlers {
  vehicles: Vehicle[];
  selectedVehicles: number[];
  toggleVehicleSelection: (id: number) => void;
}

const VehicleTable = ({ 
  vehicles, 
  selectedVehicles, 
  toggleVehicleSelection,
  onVerify,
  onEdit,
  onRemove
}: VehicleTableProps) => {
  return (
    <Card>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[30px]">
              <input 
                type="checkbox"
                className="translate-y-[2px]"
                checked={selectedVehicles.length === vehicles.length}
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
            <TableHead>Vehicle</TableHead>
            <TableHead>Year</TableHead>
            <TableHead>Location</TableHead>
            <TableHead>Price</TableHead>
            <TableHead>Mileage</TableHead>
            <TableHead>Added</TableHead>
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
              <TableCell>{vehicle.mileage.toLocaleString()} mi</TableCell>
              <TableCell>{vehicle.added}</TableCell>
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
