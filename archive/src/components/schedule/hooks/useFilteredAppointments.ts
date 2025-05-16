
import { useState, useEffect } from 'react';
import { isSameDay } from 'date-fns';
import { Appointment } from '../types/scheduleTypes';

interface UseFilteredAppointmentsProps {
  appointments: Appointment[];
  currentDate: Date;
  view: 'day' | 'week' | 'month';
}

export const useFilteredAppointments = ({
  appointments,
  currentDate,
  view
}: UseFilteredAppointmentsProps) => {
  const [filteredAppointments, setFilteredAppointments] = useState<Appointment[]>([]);

  useEffect(() => {
    // Filter appointments based on the current view and date
    let filtered: Appointment[] = [];
    
    if (view === 'day') {
      filtered = appointments.filter(app => 
        isSameDay(app.startTime, currentDate)
      );
    } else if (view === 'week') {
      const weekStart = new Date(currentDate);
      weekStart.setDate(weekStart.getDate() - weekStart.getDay());
      
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);
      
      filtered = appointments.filter(app => 
        app.startTime >= weekStart && app.startTime <= weekEnd
      );
    } else {
      // Month view - all appointments will be shown in the calendar
      filtered = appointments;
    }
    
    setFilteredAppointments(filtered);
  }, [appointments, currentDate, view]);

  return { filteredAppointments };
};
