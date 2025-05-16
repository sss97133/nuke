
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface CalendarHeaderProps {
  currentDate: Date;
  view: 'month' | 'week' | 'day';
  onNavigate: (direction: 'prev' | 'next') => void;
}

export const CalendarHeader = ({
  currentDate,
  view,
  onNavigate,
}: CalendarHeaderProps) => {
  return (
    <div className="flex justify-between items-center mb-4">
      <Button 
        variant="outline" 
        size="sm"
        onClick={() => onNavigate('prev')}
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      
      <h2 className="text-lg font-semibold">
        {format(currentDate, view === 'month' ? 'MMMM yyyy' : 'MMMM d, yyyy')}
      </h2>
      
      <Button 
        variant="outline" 
        size="sm"
        onClick={() => onNavigate('next')}
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
};
