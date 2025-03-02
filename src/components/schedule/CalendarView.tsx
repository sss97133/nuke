import { useState, useEffect } from 'react';
import { Calendar } from '@/components/ui/calendar';
import { format, startOfWeek, endOfWeek, startOfDay, addDays, isSameDay } from 'date-fns';
import { CalendarViewProps, Appointment } from './types/scheduleTypes';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

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
      const weekStart = startOfWeek(currentDate);
      const weekEnd = endOfWeek(currentDate);
      filtered = appointments.filter(app => 
        app.startTime >= weekStart && app.startTime <= weekEnd
      );
    } else {
      // Month view - all appointments will be shown in the calendar
      filtered = appointments;
    }
    
    setVisibleAppointments(filtered);
  }, [appointments, currentDate, view]);

  const renderDayView = () => {
    const dayStart = startOfDay(currentDate);
    const hours = Array.from({ length: 12 }, (_, i) => i + 8); // 8 AM to 7 PM
    
    return (
      <div className="mt-4">
        <h3 className="text-xl font-semibold mb-4">
          {format(currentDate, 'EEEE, MMMM d, yyyy')}
        </h3>
        <div className="space-y-2">
          {hours.map(hour => {
            const time = new Date(dayStart);
            time.setHours(hour);
            const hourAppointments = visibleAppointments.filter(app => 
              app.startTime.getHours() === hour
            );
            
            return (
              <div key={hour} className="flex border-b pb-2">
                <div className="w-24 pr-4 text-gray-500 font-medium">
                  {format(time, 'h:mm a')}
                </div>
                <div className="flex-1">
                  {hourAppointments.map(app => (
                    <Card 
                      key={app.id} 
                      className="mb-2 cursor-pointer hover:shadow-md transition-shadow"
                      onClick={() => onAppointmentClick(app)}
                      style={{ borderLeft: `4px solid ${app.color || '#333'}` }}
                    >
                      <CardContent className="p-3">
                        <div className="flex justify-between items-start">
                          <div>
                            <h4 className="font-medium">{app.title}</h4>
                            <p className="text-sm text-gray-500">
                              {format(app.startTime, 'h:mm a')} - {format(app.endTime, 'h:mm a')}
                            </p>
                            {app.vehicleName && (
                              <p className="text-sm text-gray-500">
                                Vehicle: {app.vehicleName}
                              </p>
                            )}
                          </div>
                          <Badge variant={app.status === 'completed' ? 'outline' : 'default'}>
                            {app.status}
                          </Badge>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderWeekView = () => {
    const weekStart = startOfWeek(currentDate);
    const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
    
    return (
      <div className="mt-4">
        <h3 className="text-xl font-semibold mb-4">
          Week of {format(weekStart, 'MMMM d, yyyy')}
        </h3>
        <div className="grid grid-cols-7 gap-2">
          {days.map(day => {
            const dayAppointments = visibleAppointments.filter(app => 
              isSameDay(app.startTime, day)
            );
            
            return (
              <div key={day.toString()} className="border rounded-md p-2 min-h-[200px]">
                <div className="font-medium text-center mb-2 pb-1 border-b">
                  {format(day, 'EEE, MMM d')}
                </div>
                <div className="space-y-2">
                  {dayAppointments.map(app => (
                    <div 
                      key={app.id} 
                      className="text-xs p-1 rounded cursor-pointer"
                      style={{ backgroundColor: app.color || '#e2e8f0' }}
                      onClick={() => onAppointmentClick(app)}
                    >
                      <div className="font-medium truncate">{app.title}</div>
                      <div className="text-gray-700">
                        {format(app.startTime, 'h:mm a')}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderMonthView = () => {
    // For the month view, we'll use the Calendar component
    // We'll add a custom renderer to show appointments
    
    const appointmentsByDate: Record<string, Appointment[]> = {};
    
    appointments.forEach(app => {
      const dateKey = format(app.startTime, 'yyyy-MM-dd');
      if (!appointmentsByDate[dateKey]) {
        appointmentsByDate[dateKey] = [];
      }
      appointmentsByDate[dateKey].push(app);
    });
    
    return (
      <div className="mt-4">
        <Calendar
          mode="single"
          selected={currentDate}
          onSelect={date => date && onDateSelect(date)}
          className="rounded-md border"
          components={{
            DayContent: (props) => {
              const date = props.date;
              const dateKey = format(date, 'yyyy-MM-dd');
              const dayAppointments = appointmentsByDate[dateKey] || [];
              
              return (
                <div className="w-full h-full">
                  <div className="text-center">{date.getDate()}</div>
                  {dayAppointments.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {dayAppointments.slice(0, 2).map(app => (
                        <div 
                          key={app.id}
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: app.color || '#333' }}
                        />
                      ))}
                      {dayAppointments.length > 2 && (
                        <div className="text-xs text-gray-500">+{dayAppointments.length - 2}</div>
                      )}
                    </div>
                  )}
                </div>
              );
            }
          }}
        />
      </div>
    );
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <Button 
          variant="outline" 
          size="sm"
          onClick={() => {
            const newDate = new Date(currentDate);
            if (view === 'day') {
              newDate.setDate(newDate.getDate() - 1);
            } else if (view === 'week') {
              newDate.setDate(newDate.getDate() - 7);
            } else {
              newDate.setMonth(newDate.getMonth() - 1);
            }
            onDateSelect(newDate);
          }}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        
        <h2 className="text-lg font-semibold">
          {format(currentDate, view === 'month' ? 'MMMM yyyy' : 'MMMM d, yyyy')}
        </h2>
        
        <Button 
          variant="outline" 
          size="sm"
          onClick={() => {
            const newDate = new Date(currentDate);
            if (view === 'day') {
              newDate.setDate(newDate.getDate() + 1);
            } else if (view === 'week') {
              newDate.setDate(newDate.getDate() + 7);
            } else {
              newDate.setMonth(newDate.getMonth() + 1);
            }
            onDateSelect(newDate);
          }}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
      
      {view === 'day' && renderDayView()}
      {view === 'week' && renderWeekView()}
      {view === 'month' && renderMonthView()}
    </div>
  );
};
