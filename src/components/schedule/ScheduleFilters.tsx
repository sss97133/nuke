
import { AppointmentTypeFilter } from './filters/AppointmentTypeFilter';
import { StatusFilter } from './filters/StatusFilter';
import { ResourceFilters } from './filters/ResourceFilters';
import { DateRangeFilter } from './filters/DateRangeFilter';
import { FilterActions } from './filters/FilterActions';
import { ScheduleFiltersProps } from './types/scheduleTypes';
import { useScheduleFilters } from './hooks/useScheduleFilters';

export const ScheduleFilters = ({
  onFilterChange,
  currentFilters,
  availableVehicles,
  availableTechnicians
}: ScheduleFiltersProps) => {
  const {
    appointmentTypes,
    setAppointmentTypes,
    statuses,
    setStatuses,
    vehicleId,
    setVehicleId,
    technicianId,
    setTechnicianId,
    dateRange,
    setDateRange,
    getFiltersData,
    resetFilters
  } = useScheduleFilters({ initialFilters: currentFilters });

  const handleApplyFilters = () => {
    onFilterChange(getFiltersData());
  };

  const handleClearFilters = () => {
    resetFilters();
    onFilterChange({});
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-4">
          <AppointmentTypeFilter 
            initialTypes={appointmentTypes} 
            onChange={setAppointmentTypes} 
          />
          
          <StatusFilter 
            initialStatuses={statuses} 
            onChange={setStatuses} 
          />
        </div>
        
        <div className="space-y-4">
          <ResourceFilters 
            vehicleId={vehicleId}
            setVehicleId={setVehicleId}
            technicianId={technicianId}
            setTechnicianId={setTechnicianId}
            availableVehicles={availableVehicles}
            availableTechnicians={availableTechnicians}
          />
          
          <DateRangeFilter 
            dateRange={dateRange}
            setDateRange={setDateRange}
          />
        </div>
      </div>
      
      <FilterActions 
        onApply={handleApplyFilters} 
        onClear={handleClearFilters} 
      />
    </div>
  );
};
