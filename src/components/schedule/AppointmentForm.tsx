
import { useState, useEffect } from 'react';
import { Calendar, Clock } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar as CalendarPicker } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { AppointmentFormProps, Appointment } from './types/scheduleTypes';
import { TimeSlots } from './TimeSlots';

export const AppointmentForm = ({
  appointment,
  onSubmit,
  onCancel,
  vehicles,
  technicians
}: AppointmentFormProps) => {
  const isEditing = !!appointment;
  const [title, setTitle] = useState(appointment?.title || '');
  const [description, setDescription] = useState(appointment?.description || '');
  const [startDate, setStartDate] = useState<Date>(appointment?.startTime || new Date());
  const [endDate, setEndDate] = useState<Date>(appointment?.endTime || new Date());
  const [selectedVehicle, setSelectedVehicle] = useState(appointment?.vehicleId || '');
  const [selectedTechnician, setSelectedTechnician] = useState(appointment?.technicianId || '');
  const [status, setStatus] = useState(appointment?.status || 'scheduled');
  const [type, setType] = useState(appointment?.type || 'maintenance');
  const [location, setLocation] = useState(appointment?.location || '');
  const [notes, setNotes] = useState(appointment?.notes || '');
  const [showTimePicker, setShowTimePicker] = useState(false);

  // Auto-calculate end time (1 hour after start time)
  useEffect(() => {
    if (!appointment) {
      const newEndDate = new Date(startDate);
      newEndDate.setHours(newEndDate.getHours() + 1);
      setEndDate(newEndDate);
    }
  }, [startDate, appointment]);

  const handleSubmit = () => {
    const formData: Appointment = {
      id: appointment?.id || '',
      title,
      description,
      startTime: startDate,
      endTime: endDate,
      vehicleId: selectedVehicle,
      vehicleName: vehicles.find(v => v.id === selectedVehicle)?.name,
      technicianId: selectedTechnician,
      technicianName: technicians.find(t => t.id === selectedTechnician)?.name,
      status: status as 'scheduled' | 'in-progress' | 'completed' | 'cancelled',
      type: type as 'maintenance' | 'repair' | 'inspection' | 'other',
      location,
      notes,
      color: appointment?.color || '#2196F3'
    };

    onSubmit(formData);
  };

  const handleTimeSlotSelect = (start: Date, end: Date) => {
    setStartDate(start);
    setEndDate(end);
    setShowTimePicker(false);
  };

  return (
    <Dialog open={true} onOpenChange={() => onCancel()}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit Appointment' : 'Create New Appointment'}</DialogTitle>
        </DialogHeader>
        
        <div className="grid gap-4 py-4">
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
            <Select value={type} onValueChange={setType}>
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
          
          <div className="grid grid-cols-4 gap-4">
            <Label htmlFor="date" className="text-right pt-2">
              Date
            </Label>
            <div className="col-span-3">
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant={"outline"}
                    className="w-full justify-start text-left font-normal"
                  >
                    <Calendar className="mr-2 h-4 w-4" />
                    {format(startDate, "PPP")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <CalendarPicker
                    mode="single"
                    selected={startDate}
                    onSelect={(date) => date && setStartDate(date)}
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>
          
          <div className="grid grid-cols-4 gap-4">
            <Label htmlFor="time" className="text-right pt-2">
              Time
            </Label>
            <div className="col-span-3">
              <div className="flex items-center space-x-2">
                <Button
                  variant={"outline"}
                  className="justify-start text-left font-normal"
                  onClick={() => setShowTimePicker(true)}
                >
                  <Clock className="mr-2 h-4 w-4" />
                  {format(startDate, "h:mm a")} - {format(endDate, "h:mm a")}
                </Button>
                {showTimePicker && (
                  <Dialog open={showTimePicker} onOpenChange={setShowTimePicker}>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Select Time Slot</DialogTitle>
                      </DialogHeader>
                      <TimeSlots
                        date={startDate}
                        availableSlots={[
                          { startTime: new Date(startDate.setHours(9, 0)), endTime: new Date(startDate.setHours(10, 0)), available: true },
                          { startTime: new Date(startDate.setHours(10, 0)), endTime: new Date(startDate.setHours(11, 0)), available: true },
                          { startTime: new Date(startDate.setHours(11, 0)), endTime: new Date(startDate.setHours(12, 0)), available: true },
                          { startTime: new Date(startDate.setHours(13, 0)), endTime: new Date(startDate.setHours(14, 0)), available: true },
                          { startTime: new Date(startDate.setHours(14, 0)), endTime: new Date(startDate.setHours(15, 0)), available: true },
                          { startTime: new Date(startDate.setHours(15, 0)), endTime: new Date(startDate.setHours(16, 0)), available: true },
                          { startTime: new Date(startDate.setHours(16, 0)), endTime: new Date(startDate.setHours(17, 0)), available: true },
                        ]}
                        onSlotSelect={handleTimeSlotSelect}
                      />
                    </DialogContent>
                  </Dialog>
                )}
              </div>
            </div>
          </div>
          
          <div className="grid grid-cols-4 gap-4">
            <Label htmlFor="vehicle" className="text-right pt-2">
              Vehicle
            </Label>
            <Select value={selectedVehicle} onValueChange={setSelectedVehicle}>
              <SelectTrigger className="col-span-3">
                <SelectValue placeholder="Select a vehicle" />
              </SelectTrigger>
              <SelectContent>
                {vehicles.map((vehicle) => (
                  <SelectItem key={vehicle.id} value={vehicle.id}>
                    {vehicle.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          <div className="grid grid-cols-4 gap-4">
            <Label htmlFor="technician" className="text-right pt-2">
              Technician
            </Label>
            <Select value={selectedTechnician} onValueChange={setSelectedTechnician}>
              <SelectTrigger className="col-span-3">
                <SelectValue placeholder="Assign a technician" />
              </SelectTrigger>
              <SelectContent>
                {technicians.map((tech) => (
                  <SelectItem key={tech.id} value={tech.id}>
                    {tech.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          {isEditing && (
            <div className="grid grid-cols-4 gap-4">
              <Label htmlFor="status" className="text-right pt-2">
                Status
              </Label>
              <Select value={status} onValueChange={setStatus}>
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
        </div>
        
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" onClick={handleSubmit}>
            {isEditing ? 'Update' : 'Schedule'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
