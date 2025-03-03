
import React from 'react';
import { Button } from "@/components/ui/button";
import { Plus, FilePlus, Edit } from "lucide-react";

interface MaintenanceHeaderProps {
  onBulkEntryOpen: () => void;
  onBulkEditOpen: () => void;
}

const MaintenanceHeader: React.FC<MaintenanceHeaderProps> = ({ 
  onBulkEntryOpen, 
  onBulkEditOpen 
}) => {
  return (
    <div className="flex justify-between items-center mb-6">
      <div>
        <h1 className="text-3xl font-bold">Maintenance Management</h1>
        <p className="text-muted-foreground mt-1">
          Schedule and track routine vehicle maintenance
        </p>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" className="flex gap-1" onClick={onBulkEntryOpen}>
          <FilePlus className="h-4 w-4" />
          Bulk Create
        </Button>
        <Button variant="outline" className="flex gap-1" onClick={onBulkEditOpen}>
          <Edit className="h-4 w-4" />
          Bulk Edit
        </Button>
        <Button className="flex gap-1">
          <Plus className="h-4 w-4" />
          Schedule Maintenance
        </Button>
      </div>
    </div>
  );
};

export default MaintenanceHeader;
