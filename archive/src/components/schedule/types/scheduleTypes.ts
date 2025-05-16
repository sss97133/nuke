
import { ReactNode } from 'react';

export interface Appointment {
  id: string;
  title: string;
  description?: string;
  startTime: Date;
  endTime: Date;
  vehicleId?: string;
  vehicleName?: string;
  technicianId?: string;
  technicianName?: string;
  status: 'scheduled' | 'in-progress' | 'completed' | 'cancelled';
  type: 'maintenance' | 'repair' | 'inspection' | 'other';
  location?: string;
  notes?: string;
  color?: string;
}

export interface CalendarViewProps {
  appointments: Appointment[];
  onAppointmentClick: (appointment: Appointment) => void;
  onDateSelect: (date: Date) => void;
  view: 'month' | 'week' | 'day';
  currentDate: Date;
  onViewChange: (view: 'month' | 'week' | 'day') => void;
}

export interface AppointmentFormProps {
  appointment?: Appointment;
  onSubmit: (appointment: Appointment) => void;
  onCancel: () => void;
  vehicles: { id: string; name: string }[];
  technicians: { id: string; name: string }[];
}

export interface ScheduleFiltersProps {
  onFilterChange: (filters: ScheduleFilters) => void;
  currentFilters: ScheduleFilters;
  availableVehicles: { id: string; name: string }[];
  availableTechnicians: { id: string; name: string }[];
}

export interface ScheduleFilters {
  appointmentType?: string[];
  status?: string[];
  vehicleId?: string;
  technicianId?: string;
  dateRange?: {
    start: Date;
    end: Date;
  };
}

export interface AppointmentCardProps {
  appointment: Appointment;
  onClick: (appointment: Appointment) => void;
}

export interface TimeSlotProps {
  date: Date;
  availableSlots: {
    startTime: Date;
    endTime: Date;
    available: boolean;
  }[];
  onSlotSelect: (startTime: Date, endTime: Date) => void;
}

export interface ScheduleSummaryProps {
  title: string;
  value: string | number;
  description?: string;
  icon?: ReactNode;
}
