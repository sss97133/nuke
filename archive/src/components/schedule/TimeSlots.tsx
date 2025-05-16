
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { TimeSlotProps } from './types/scheduleTypes';

export const TimeSlots = ({
  date,
  availableSlots,
  onSlotSelect
}: TimeSlotProps) => {
  const formatTimeSlot = (startTime: Date, endTime: Date) => {
    return `${format(startTime, 'h:mm a')} - ${format(endTime, 'h:mm a')}`;
  };

  return (
    <div className="space-y-4">
      <h3 className="font-medium">Available time slots for {format(date, 'MMMM d, yyyy')}</h3>
      <div className="grid grid-cols-2 gap-2">
        {availableSlots.map((slot, index) => (
          <Button
            key={index}
            variant={slot.available ? "outline" : "secondary"}
            disabled={!slot.available}
            className="justify-start"
            onClick={() => onSlotSelect(slot.startTime, slot.endTime)}
          >
            {formatTimeSlot(slot.startTime, slot.endTime)}
          </Button>
        ))}
      </div>
    </div>
  );
};
