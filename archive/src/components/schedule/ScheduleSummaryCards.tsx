
import { Calendar, Clock, Users, Car } from 'lucide-react';
import { format } from 'date-fns';
import { ScheduleSummary } from '@/components/schedule/ScheduleSummary';
import { Appointment } from '@/components/schedule/types/scheduleTypes';

interface ScheduleSummaryCardsProps {
  appointments: Appointment[];
  techniciansCount: number;
  vehiclesCount: number;
}

export const ScheduleSummaryCards = ({
  appointments,
  techniciansCount,
  vehiclesCount
}: ScheduleSummaryCardsProps) => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
      <ScheduleSummary
        title="Total Appointments"
        value={appointments.length}
        icon={<Calendar className="h-5 w-5" />}
      />
      <ScheduleSummary
        title="Scheduled Today"
        value={appointments.filter(a => 
          format(a.startTime, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd')
        ).length}
        icon={<Clock className="h-5 w-5" />}
      />
      <ScheduleSummary
        title="Active Technicians"
        value={techniciansCount}
        icon={<Users className="h-5 w-5" />}
      />
      <ScheduleSummary
        title="Vehicles in Service"
        value={vehiclesCount}
        icon={<Car className="h-5 w-5" />}
      />
    </div>
  );
};
