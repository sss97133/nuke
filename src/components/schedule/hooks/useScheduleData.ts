
import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { Appointment } from '../types/scheduleTypes';
import { useToast } from '@/hooks/use-toast';

export interface ScheduleDataOptions {
  vehicles: { id: string; name: string }[];
  technicians: { id: string; name: string }[];
}

export const useScheduleData = (options: ScheduleDataOptions) => {
  const { toast } = useToast();
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | undefined>(undefined);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [calendarView, setCalendarView] = useState<'month' | 'week' | 'day'>('week');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [filteredAppointments, setFilteredAppointments] = useState<Appointment[]>([]);
  
  // Fetch appointments (mock implementation)
  useEffect(() => {
    // This would be replaced with an actual API call
    const mockAppointments: Appointment[] = [
      {
        id: '1',
        title: 'Oil Change',
        description: 'Regular maintenance',
        startTime: new Date(2023, 6, 10, 9, 0),
        endTime: new Date(2023, 6, 10, 10, 30),
        vehicleId: '1',
        vehicleName: '2019 Toyota Camry',
        technicianId: '1',
        technicianName: 'Alex Johnson',
        status: 'scheduled',
        type: 'maintenance',
        location: 'Main Garage',
        color: '#4CAF50',
      },
      {
        id: '2',
        title: 'Brake Inspection',
        description: 'Check brake pads and rotors',
        startTime: new Date(2023, 6, 12, 14, 0),
        endTime: new Date(2023, 6, 12, 15, 0),
        vehicleId: '2',
        vehicleName: '2020 Honda CR-V',
        technicianId: '2',
        technicianName: 'Maria Garcia',
        status: 'scheduled',
        type: 'inspection',
        location: 'Main Garage',
        color: '#2196F3',
      },
    ];

    setAppointments(mockAppointments);
    setFilteredAppointments(mockAppointments);
  }, []);

  const handleAppointmentClick = (appointment: Appointment) => {
    setSelectedAppointment(appointment);
    setIsFormOpen(true);
  };

  const handleDateSelect = (date: Date) => {
    setCurrentDate(date);
  };

  const handleFormSubmit = (appointment: Appointment) => {
    // If editing an existing appointment
    if (selectedAppointment) {
      const updatedAppointments = appointments.map(app => 
        app.id === appointment.id ? appointment : app
      );
      setAppointments(updatedAppointments);
      setFilteredAppointments(updatedAppointments);
      toast({
        title: "Appointment Updated",
        description: `${appointment.title} has been updated.`
      });
    } else {
      // Creating a new appointment
      const newAppointment = {
        ...appointment,
        id: Date.now().toString(), // Simple ID generation for demo
      };
      const updatedAppointments = [...appointments, newAppointment];
      setAppointments(updatedAppointments);
      setFilteredAppointments(updatedAppointments);
      toast({
        title: "Appointment Created",
        description: `${appointment.title} has been scheduled.`
      });
    }

    setIsFormOpen(false);
    setSelectedAppointment(undefined);
  };

  const handleFilterChange = (filters: any) => {
    // Apply filters to appointments
    let filtered = [...appointments];

    if (filters.appointmentType?.length) {
      filtered = filtered.filter(app => filters.appointmentType.includes(app.type));
    }

    if (filters.status?.length) {
      filtered = filtered.filter(app => filters.status.includes(app.status));
    }

    if (filters.vehicleId) {
      filtered = filtered.filter(app => app.vehicleId === filters.vehicleId);
    }

    if (filters.technicianId) {
      filtered = filtered.filter(app => app.technicianId === filters.technicianId);
    }

    if (filters.dateRange?.start && filters.dateRange?.end) {
      filtered = filtered.filter(app => 
        app.startTime >= filters.dateRange.start && 
        app.startTime <= filters.dateRange.end
      );
    }

    setFilteredAppointments(filtered);
    setIsFilterOpen(false);
  };

  return {
    appointments,
    filteredAppointments,
    selectedAppointment,
    isFormOpen,
    calendarView,
    currentDate,
    isFilterOpen,
    setIsFormOpen,
    setIsFilterOpen,
    setSelectedAppointment,
    handleAppointmentClick,
    handleDateSelect,
    handleFormSubmit,
    handleFilterChange,
    setCalendarView
  };
};
