
import React from 'react';
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const ImportOptions: React.FC = () => {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="import-type">Import Type</Label>
        <Select defaultValue="vehicles">
          <SelectTrigger>
            <SelectValue placeholder="Select import type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="vehicles">Vehicles</SelectItem>
            <SelectItem value="inventory">Inventory</SelectItem>
            <SelectItem value="customers">Customers</SelectItem>
            <SelectItem value="services">Service Records</SelectItem>
          </SelectContent>
        </Select>
      </div>
      
      <div className="space-y-2">
        <Label htmlFor="mapping">Field Mapping</Label>
        <Select defaultValue="auto">
          <SelectTrigger>
            <SelectValue placeholder="Select mapping method" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">Auto-detect</SelectItem>
            <SelectItem value="manual">Manual Mapping</SelectItem>
            <SelectItem value="template">Use Template</SelectItem>
          </SelectContent>
        </Select>
      </div>
      
      <div className="space-y-2">
        <Label htmlFor="conflict">Conflict Resolution</Label>
        <Select defaultValue="skip">
          <SelectTrigger>
            <SelectValue placeholder="Select conflict handling" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="skip">Skip Duplicates</SelectItem>
            <SelectItem value="overwrite">Overwrite Existing</SelectItem>
            <SelectItem value="merge">Merge Records</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
};
