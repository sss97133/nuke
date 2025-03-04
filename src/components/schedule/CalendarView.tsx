
import { useState, useEffect } from 'react';
import { isSameDay } from 'date-fns';
import { CalendarViewProps, Appointment } from './types/scheduleTypes';
import { DayView } from './calendar/DayView';
import { WeekView } from './calendar/WeekView';
import { MonthView } from './calendar/MonthView';
import { CalendarHeader } from './calendar/CalendarHeader';

export const CalendarView = ({
  appointments,
  onAppointmentClick,
  onDateSelect,
  view,
  currentDate,
  onViewChange
}: CalendarViewProps) => {
  const [visibleAppointments, setVisibleAppointments] = useState<Appointment[]>([]);

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
    
    setVisibleAppointments(filtered);
  }, [appointments, currentDate, view]);

  const handleNavigate = (direction: 'prev' | 'next') => {
    const newDate = new Date(currentDate);
    
    if (direction === 'prev') {
      if (view === 'day') {
        newDate.setDate(newDate.getDate() - 1);
      } else if (view === 'week') {
        newDate.setDate(newDate.getDate() - 7);
      } else {
        newDate.setMonth(newDate.getMonth() - 1);
      }
    } else {
      if (view === 'day') {
        newDate.setDate(newDate.getDate() + 1);
      } else if (view === 'week') {
        newDate.setDate(newDate.getDate() + 7);
      } else {
        newDate.setMonth(newDate.getMonth() + 1);
      }
    }
    
    onDateSelect(newDate);
  };

  return (
    <div>
      <CalendarHeader 
        currentDate={currentDate}
        view={view}
        onNavigate={handleNavigate}
      />
      
      {view === 'day' && (
        <DayView 
          currentDate={currentDate}
          appointments={visibleAppointments}
          onAppointmentClick={onAppointmentClick}
        />
      )}
      
      {view === 'week' && (
        <WeekView 
          currentDate={currentDate}
          appointments={visibleAppointments}
          onAppointmentClick={onAppointmentClick}
        />
      )}
      
      {view === 'month' && (
        <MonthView 
          currentDate={currentDate}
          appointments={visibleAppointments}
          onDateSelect={onDateSelect}
        />
      )}
    </div>
  );
};
