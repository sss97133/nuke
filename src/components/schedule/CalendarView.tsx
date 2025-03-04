
import { useState } from 'react';
import { CalendarViewProps } from './types/scheduleTypes';
import { DayView } from './calendar/DayView';
import { WeekView } from './calendar/WeekView';
import { MonthView } from './calendar/MonthView';
import { CalendarHeader } from './calendar/CalendarHeader';
import { useFilteredAppointments } from './hooks/useFilteredAppointments';

export const CalendarView = ({
  appointments,
  onAppointmentClick,
  onDateSelect,
  view,
  currentDate,
  onViewChange
}: CalendarViewProps) => {
  const { filteredAppointments } = useFilteredAppointments({
    appointments,
    currentDate,
    view
  });

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
          appointments={filteredAppointments}
          onAppointmentClick={onAppointmentClick}
        />
      )}
      
      {view === 'week' && (
        <WeekView 
          currentDate={currentDate}
          appointments={filteredAppointments}
          onAppointmentClick={onAppointmentClick}
        />
      )}
      
      {view === 'month' && (
        <MonthView 
          currentDate={currentDate}
          appointments={filteredAppointments}
          onDateSelect={onDateSelect}
        />
      )}
    </div>
  );
};
