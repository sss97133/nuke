
import { useState } from 'react';
import { DateRange } from 'react-day-picker';
import { ScheduleFilters } from '../types/scheduleTypes';

interface UseScheduleFiltersProps {
  initialFilters: ScheduleFilters;
}

export const useScheduleFilters = ({ initialFilters }: UseScheduleFiltersProps) => {
  const [appointmentTypes, setAppointmentTypes] = useState<string[]>(
    initialFilters.appointmentType || []
  );
  const [statuses, setStatuses] = useState<string[]>(
    initialFilters.status || []
  );
  const [vehicleId, setVehicleId] = useState<string>(
    initialFilters.vehicleId || ''
  );
  const [technicianId, setTechnicianId] = useState<string>(
    initialFilters.technicianId || ''
  );
  const [dateRange, setDateRange] = useState<DateRange | undefined>(
    initialFilters.dateRange ? {
      from: initialFilters.dateRange.start,
      to: initialFilters.dateRange.end
    } : undefined
  );

  const getFiltersData = () => ({
    appointmentType: appointmentTypes,
    status: statuses,
    vehicleId: vehicleId || undefined,
    technicianId: technicianId || undefined,
    dateRange: dateRange ? {
      start: dateRange.from as Date,
      end: dateRange.to as Date || dateRange.from as Date
    } : undefined
  });

  const resetFilters = () => {
    setAppointmentTypes([]);
    setStatuses([]);
    setVehicleId('');
    setTechnicianId('');
    setDateRange(undefined);
  };

  return {
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
  };
};
