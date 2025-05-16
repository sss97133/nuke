
import React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface AppointmentDetailsProps {
  title: string;
  setTitle: (value: string) => void;
  description: string;
  setDescription: (value: string) => void;
  type: 'maintenance' | 'repair' | 'inspection' | 'other';
  setType: (value: 'maintenance' | 'repair' | 'inspection' | 'other') => void;
  location: string;
  setLocation: (value: string) => void;
  notes: string;
  setNotes: (value: string) => void;
  status: 'scheduled' | 'in-progress' | 'completed' | 'cancelled';
  setStatus: (value: 'scheduled' | 'in-progress' | 'completed' | 'cancelled') => void;
  isEditing: boolean;
}

export const AppointmentDetails: React.FC<AppointmentDetailsProps> = ({
  title,
  setTitle,
  description,
  setDescription,
  type,
  setType,
  location,
  setLocation,
  notes,
  setNotes,
  status,
  setStatus,
  isEditing
}) => {
  return (
    <>
      <div className="grid grid-cols-4 gap-4">
        <Label htmlFor="title" className="text-right pt-2">
          Title
        </Label>
        <Input
          id="title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="col-span-3"
          placeholder="Appointment title"
        />
      </div>
      
      <div className="grid grid-cols-4 gap-4">
        <Label htmlFor="type" className="text-right pt-2">
          Type
        </Label>
        <Select 
          value={type} 
          onValueChange={(value: 'maintenance' | 'repair' | 'inspection' | 'other') => setType(value)}
        >
          <SelectTrigger className="col-span-3">
            <SelectValue placeholder="Select type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="maintenance">Maintenance</SelectItem>
            <SelectItem value="repair">Repair</SelectItem>
            <SelectItem value="inspection">Inspection</SelectItem>
            <SelectItem value="other">Other</SelectItem>
          </SelectContent>
        </Select>
      </div>
      
      {isEditing && (
        <div className="grid grid-cols-4 gap-4">
          <Label htmlFor="status" className="text-right pt-2">
            Status
          </Label>
          <Select 
            value={status} 
            onValueChange={(value: 'scheduled' | 'in-progress' | 'completed' | 'cancelled') => setStatus(value)}
          >
            <SelectTrigger className="col-span-3">
              <SelectValue placeholder="Select status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="scheduled">Scheduled</SelectItem>
              <SelectItem value="in-progress">In Progress</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
      
      <div className="grid grid-cols-4 gap-4">
        <Label htmlFor="location" className="text-right pt-2">
          Location
        </Label>
        <Input
          id="location"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          className="col-span-3"
          placeholder="Service location"
        />
      </div>
      
      <div className="grid grid-cols-4 gap-4">
        <Label htmlFor="description" className="text-right pt-2">
          Description
        </Label>
        <Textarea
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="col-span-3"
          placeholder="Appointment details"
        />
      </div>
      
      <div className="grid grid-cols-4 gap-4">
        <Label htmlFor="notes" className="text-right pt-2">
          Notes
        </Label>
        <Textarea
          id="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="col-span-3"
          placeholder="Additional notes"
        />
      </div>
    </>
  );
};
