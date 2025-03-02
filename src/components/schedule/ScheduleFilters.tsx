
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DateRange } from 'react-day-picker';
import { DatePickerWithRange } from '@/components/service-history/DatePickerWithRange';
import { ScheduleFiltersProps } from './types/scheduleTypes';

export const ScheduleFilters = ({
  onFilterChange,
  currentFilters,
  availableVehicles,
  availableTechnicians
}: ScheduleFiltersProps) => {
  const [appointmentTypes, setAppointmentTypes] = useState<string[]>(
    currentFilters.appointmentType || []
  );
  const [statuses, setStatuses] = useState<string[]>(
    currentFilters.status || []
  );
  const [vehicleId, setVehicleId] = useState<string>(
    currentFilters.vehicleId || ''
  );
  const [technicianId, setTechnicianId] = useState<string>(
    currentFilters.technicianId || ''
  );
  const [dateRange, setDateRange] = useState<DateRange | undefined>(
    currentFilters.dateRange ? {
      from: currentFilters.dateRange.start,
      to: currentFilters.dateRange.end
    } : undefined
  );

  const handleTypeChange = (type: string, checked: boolean) => {
    if (checked) {
      setAppointmentTypes([...appointmentTypes, type]);
    } else {
      setAppointmentTypes(appointmentTypes.filter(t => t !== type));
    }
  };
  
  const handleStatusChange = (status: string, checked: boolean) => {
    if (checked) {
      setStatuses([...statuses, status]);
    } else {
      setStatuses(statuses.filter(s => s !== status));
    }
  };

  const handleApplyFilters = () => {
    onFilterChange({
      appointmentType: appointmentTypes,
      status: statuses,
      vehicleId: vehicleId || undefined,
      technicianId: technicianId || undefined,
      dateRange: dateRange ? {
        start: dateRange.from as Date,
        end: dateRange.to as Date || dateRange.from as Date
      } : undefined
    });
  };

  const handleClearFilters = () => {
    setAppointmentTypes([]);
    setStatuses([]);
    setVehicleId('');
    setTechnicianId('');
    setDateRange(undefined);
    
    onFilterChange({});
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-4">
          <div>
            <h3 className="text-lg font-medium mb-2">Appointment Type</h3>
            <div className="space-y-2">
              <div className="flex items-center space-x-2">
                <Checkbox 
                  id="type-maintenance" 
                  checked={appointmentTypes.includes('maintenance')}
                  onCheckedChange={(checked) => 
                    handleTypeChange('maintenance', checked as boolean)
                  }
                />
                <Label htmlFor="type-maintenance">Maintenance</Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox 
                  id="type-repair" 
                  checked={appointmentTypes.includes('repair')}
                  onCheckedChange={(checked) => 
                    handleTypeChange('repair', checked as boolean)
                  }
                />
                <Label htmlFor="type-repair">Repair</Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox 
                  id="type-inspection" 
                  checked={appointmentTypes.includes('inspection')}
                  onCheckedChange={(checked) => 
                    handleTypeChange('inspection', checked as boolean)
                  }
                />
                <Label htmlFor="type-inspection">Inspection</Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox 
                  id="type-other" 
                  checked={appointmentTypes.includes('other')}
                  onCheckedChange={(checked) => 
                    handleTypeChange('other', checked as boolean)
                  }
                />
                <Label htmlFor="type-other">Other</Label>
              </div>
            </div>
          </div>
          
          <div>
            <h3 className="text-lg font-medium mb-2">Status</h3>
            <div className="space-y-2">
              <div className="flex items-center space-x-2">
                <Checkbox 
                  id="status-scheduled" 
                  checked={statuses.includes('scheduled')}
                  onCheckedChange={(checked) => 
                    handleStatusChange('scheduled', checked as boolean)
                  }
                />
                <Label htmlFor="status-scheduled">Scheduled</Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox 
                  id="status-in-progress" 
                  checked={statuses.includes('in-progress')}
                  onCheckedChange={(checked) => 
                    handleStatusChange('in-progress', checked as boolean)
                  }
                />
                <Label htmlFor="status-in-progress">In Progress</Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox 
                  id="status-completed" 
                  checked={statuses.includes('completed')}
                  onCheckedChange={(checked) => 
                    handleStatusChange('completed', checked as boolean)
                  }
                />
                <Label htmlFor="status-completed">Completed</Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox 
                  id="status-cancelled" 
                  checked={statuses.includes('cancelled')}
                  onCheckedChange={(checked) => 
                    handleStatusChange('cancelled', checked as boolean)
                  }
                />
                <Label htmlFor="status-cancelled">Cancelled</Label>
              </div>
            </div>
          </div>
        </div>
        
        <div className="space-y-4">
          <div>
            <h3 className="text-lg font-medium mb-2">Vehicle</h3>
            <Select value={vehicleId} onValueChange={setVehicleId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a vehicle" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">All Vehicles</SelectItem>
                {availableVehicles.map((vehicle) => (
                  <SelectItem key={vehicle.id} value={vehicle.id}>
                    {vehicle.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          <div>
            <h3 className="text-lg font-medium mb-2">Technician</h3>
            <Select value={technicianId} onValueChange={setTechnicianId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a technician" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">All Technicians</SelectItem>
                {availableTechnicians.map((tech) => (
                  <SelectItem key={tech.id} value={tech.id}>
                    {tech.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          <div>
            <h3 className="text-lg font-medium mb-2">Date Range</h3>
            <DatePickerWithRange
              date={dateRange}
              onDateChange={setDateRange}
            />
          </div>
        </div>
      </div>
      
      <div className="flex justify-end space-x-2">
        <Button variant="outline" onClick={handleClearFilters}>
          Clear Filters
        </Button>
        <Button onClick={handleApplyFilters}>
          Apply Filters
        </Button>
      </div>
    </div>
  );
};
