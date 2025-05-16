
import { format } from 'date-fns';
import { Calendar } from '@/components/ui/calendar';
import { Appointment } from '../types/scheduleTypes';

interface MonthViewProps {
  currentDate: Date;
  appointments: Appointment[];
  onDateSelect: (date: Date) => void;
}

export const MonthView = ({
  currentDate,
  appointments,
  onDateSelect,
}: MonthViewProps) => {
  // Group appointments by date for easy lookup
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
