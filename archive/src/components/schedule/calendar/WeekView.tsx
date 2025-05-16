
import { format, startOfWeek, addDays, isSameDay } from 'date-fns';
import { Appointment } from '../types/scheduleTypes';

interface WeekViewProps {
  currentDate: Date;
  appointments: Appointment[];
  onAppointmentClick: (appointment: Appointment) => void;
}

export const WeekView = ({
  currentDate,
  appointments,
  onAppointmentClick
}: WeekViewProps) => {
  const weekStart = startOfWeek(currentDate);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  
  return (
    <div className="mt-4">
      <h3 className="text-xl font-semibold mb-4">
        Week of {format(weekStart, 'MMMM d, yyyy')}
      </h3>
      <div className="grid grid-cols-7 gap-2">
        {days.map(day => {
          const dayAppointments = appointments.filter(app => 
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
