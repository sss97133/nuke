
import React from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface ServiceDetailsProps {
  serviceType: string;
  status: string;
  laborHours?: number;
  technicianNotes: string;
  onServiceTypeChange: (type: string) => void;
  onStatusChange: (status: string) => void;
  onLaborHoursChange: (hours: number | undefined) => void;
  onTechnicianNotesChange: (notes: string) => void;
}

const ServiceDetails: React.FC<ServiceDetailsProps> = ({
  serviceType,
  status,
  laborHours,
  technicianNotes,
  onServiceTypeChange,
  onStatusChange,
  onLaborHoursChange,
  onTechnicianNotesChange
}) => {
  return (
    <>
      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-2">
          <Label htmlFor="serviceType">Service Type</Label>
          <Select value={serviceType} onValueChange={onServiceTypeChange}>
            <SelectTrigger id="serviceType">
              <SelectValue placeholder="Select service type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="routine_maintenance">Routine Maintenance</SelectItem>
              <SelectItem value="repair">Repair</SelectItem>
              <SelectItem value="inspection">Inspection</SelectItem>
              <SelectItem value="modification">Modification</SelectItem>
              <SelectItem value="emergency">Emergency</SelectItem>
              <SelectItem value="recall">Recall</SelectItem>
            </SelectContent>
          </Select>
        </div>
        
        <div className="grid gap-2">
          <Label htmlFor="status">Status</Label>
          <Select value={status} onValueChange={onStatusChange}>
            <SelectTrigger id="status">
              <SelectValue placeholder="Select status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="in-progress">In Progress</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="laborHours">Labor Hours</Label>
        <Input
          id="laborHours"
          type="number"
          min="0"
          step="0.5"
          value={laborHours || ''}
          onChange={(e) => onLaborHoursChange(e.target.value ? parseFloat(e.target.value) : undefined)}
          placeholder="Enter labor hours"
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="technicianNotes">Technician Notes</Label>
        <Textarea
          id="technicianNotes"
          value={technicianNotes}
          onChange={(e) => onTechnicianNotesChange(e.target.value)}
          placeholder="Additional notes about the service"
          className="min-h-[80px]"
        />
      </div>
    </>
  );
};

export default ServiceDetails;
