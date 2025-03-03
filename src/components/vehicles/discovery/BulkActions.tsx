
import React from 'react';
import { Button } from "@/components/ui/button";
import { ChevronDown, CheckCircle, Plus, Trash2, X } from 'lucide-react';

interface BulkActionsProps {
  selectedVehicles: number[];
  setSelectedVehicles: (vehicles: number[]) => void;
  bulkActionOpen: boolean;
  setBulkActionOpen: (open: boolean) => void;
  onBulkVerify: () => void;
  onBulkAddToGarage: () => void;
  onBulkRemove: () => void;
}

const BulkActions = ({
  selectedVehicles,
  setSelectedVehicles,
  bulkActionOpen,
  setBulkActionOpen,
  onBulkVerify,
  onBulkAddToGarage,
  onBulkRemove
}: BulkActionsProps) => {
  if (selectedVehicles.length === 0) {
    return null;
  }

  return (
    <div className="bg-muted rounded-md p-3 flex items-center justify-between">
      <div className="flex items-center">
        <span className="font-medium">{selectedVehicles.length} vehicles selected</span>
        <Button variant="ghost" size="sm" className="ml-2" onClick={() => setSelectedVehicles([])}>
          Clear
        </Button>
      </div>
      <div className="flex gap-2">
        <div className="relative">
          <Button
            variant="default"
            size="sm"
            className="gap-1"
            onClick={() => setBulkActionOpen(!bulkActionOpen)}
          >
            Bulk Actions
            <ChevronDown className="h-4 w-4" />
          </Button>
          {bulkActionOpen && (
            <div className="absolute right-0 top-full mt-1 bg-background border rounded-md shadow-md p-1 z-50 flex flex-col w-40">
              <Button variant="ghost" size="sm" className="justify-start" onClick={onBulkVerify}>
                <CheckCircle className="h-4 w-4 mr-2" />
                Verify All
              </Button>
              <Button variant="ghost" size="sm" className="justify-start" onClick={onBulkAddToGarage}>
                <Plus className="h-4 w-4 mr-2" />
                Add to Garage
              </Button>
              <Button variant="ghost" size="sm" className="justify-start text-destructive hover:text-destructive" onClick={onBulkRemove}>
                <Trash2 className="h-4 w-4 mr-2" />
                Remove All
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default BulkActions;
