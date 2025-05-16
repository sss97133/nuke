
import { Button } from '@/components/ui/button';
import { Filter } from 'lucide-react';

interface ScheduleHeaderProps {
  onAddAppointment: () => void;
  onToggleFilters: () => void;
  isFilterOpen: boolean;
}

export const ScheduleHeader = ({
  onAddAppointment,
  onToggleFilters,
  isFilterOpen
}: ScheduleHeaderProps) => {
  return (
    <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6">
      <h1 className="text-3xl font-bold">Schedule</h1>
      <div className="flex mt-4 md:mt-0 space-x-2">
        <Button 
          variant="outline" 
          onClick={onToggleFilters}
        >
          <Filter className="h-4 w-4 mr-2" />
          Filters
        </Button>
        <Button onClick={onAddAppointment}>
          Add Appointment
        </Button>
      </div>
    </div>
  );
};
