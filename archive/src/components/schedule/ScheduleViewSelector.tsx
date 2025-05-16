
import { Button } from '@/components/ui/button';

interface ScheduleViewSelectorProps {
  view: 'month' | 'week' | 'day';
  onViewChange: (view: 'month' | 'week' | 'day') => void;
}

export const ScheduleViewSelector = ({
  view,
  onViewChange
}: ScheduleViewSelectorProps) => {
  return (
    <div className="flex justify-end space-x-2 mb-4">
      <Button 
        variant={view === 'month' ? 'default' : 'outline'} 
        onClick={() => onViewChange('month')}
        size="sm"
      >
        Month
      </Button>
      <Button 
        variant={view === 'week' ? 'default' : 'outline'} 
        onClick={() => onViewChange('week')}
        size="sm"
      >
        Week
      </Button>
      <Button 
        variant={view === 'day' ? 'default' : 'outline'} 
        onClick={() => onViewChange('day')}
        size="sm"
      >
        Day
      </Button>
    </div>
  );
};
