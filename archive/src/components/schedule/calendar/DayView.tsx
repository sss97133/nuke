
import { format, startOfDay } from 'date-fns';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Appointment } from '../types/scheduleTypes';

interface DayViewProps {
  currentDate: Date;
  appointments: Appointment[];
  onAppointmentClick: (appointment: Appointment) => void;
}

export const DayView = ({
  currentDate,
  appointments,
  onAppointmentClick
}: DayViewProps) => {
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
          const hourAppointments = appointments.filter(app => 
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
