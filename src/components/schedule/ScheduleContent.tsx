
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CalendarView } from '@/components/schedule/CalendarView';
import { AppointmentList } from '@/components/schedule/AppointmentList';
import { ScheduleViewSelector } from '@/components/schedule/ScheduleViewSelector';
import { Appointment } from '@/components/schedule/types/scheduleTypes';

interface ScheduleContentProps {
  appointments: Appointment[];
  onAppointmentClick: (appointment: Appointment) => void;
  onDateSelect: (date: Date) => void;
  calendarView: 'month' | 'week' | 'day';
  currentDate: Date;
  onViewChange: (view: 'month' | 'week' | 'day') => void;
}

export const ScheduleContent = ({
  appointments,
  onAppointmentClick,
  onDateSelect,
  calendarView,
  currentDate,
  onViewChange
}: ScheduleContentProps) => {
  return (
    <Tabs defaultValue="calendar" className="w-full">
      <TabsList className="mb-4">
        <TabsTrigger value="calendar">Calendar</TabsTrigger>
        <TabsTrigger value="list">List View</TabsTrigger>
      </TabsList>
      
      <TabsContent value="calendar" className="space-y-4">
        <ScheduleViewSelector 
          view={calendarView} 
          onViewChange={onViewChange} 
        />
        
        <CalendarView
          appointments={appointments}
          onAppointmentClick={onAppointmentClick}
          onDateSelect={onDateSelect}
          view={calendarView}
          currentDate={currentDate}
          onViewChange={onViewChange}
        />
      </TabsContent>
      
      <TabsContent value="list">
        <AppointmentList 
          appointments={appointments}
          onAppointmentClick={onAppointmentClick}
        />
      </TabsContent>
    </Tabs>
  );
};
