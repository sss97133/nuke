
import React, { useState } from 'react';
import { Calendar, Clock } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Calendar as CalendarPicker } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { format } from 'date-fns';
import { TimeSlots } from '../TimeSlots';

interface DateTimeSelectorProps {
  startDate: Date;
  setStartDate: (date: Date) => void;
  endDate: Date;
  setEndDate: (date: Date) => void;
}

export const DateTimeSelector: React.FC<DateTimeSelectorProps> = ({
  startDate,
  setStartDate,
  endDate,
  setEndDate
}) => {
  const [showTimePicker, setShowTimePicker] = useState(false);

  const handleTimeSlotSelect = (start: Date, end: Date) => {
    setStartDate(start);
    setEndDate(end);
    setShowTimePicker(false);
  };

  return (
    <>
      <div className="grid grid-cols-4 gap-4">
        <Label htmlFor="date" className="text-right pt-2">
          Date
        </Label>
        <div className="col-span-3">
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant={"outline"}
                className="w-full justify-start text-left font-normal"
              >
                <Calendar className="mr-2 h-4 w-4" />
                {format(startDate, "PPP")}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0">
              <CalendarPicker
                mode="single"
                selected={startDate}
                onSelect={(date) => date && setStartDate(date)}
              />
            </PopoverContent>
          </Popover>
        </div>
      </div>
      
      <div className="grid grid-cols-4 gap-4">
        <Label htmlFor="time" className="text-right pt-2">
          Time
        </Label>
        <div className="col-span-3">
          <div className="flex items-center space-x-2">
            <Button
              variant={"outline"}
              className="justify-start text-left font-normal"
              onClick={() => setShowTimePicker(true)}
            >
              <Clock className="mr-2 h-4 w-4" />
              {format(startDate, "h:mm a")} - {format(endDate, "h:mm a")}
            </Button>
            {showTimePicker && (
              <Dialog open={showTimePicker} onOpenChange={setShowTimePicker}>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Select Time Slot</DialogTitle>
                  </DialogHeader>
                  <TimeSlots
                    date={startDate}
                    availableSlots={[
                      { startTime: new Date(startDate.setHours(9, 0)), endTime: new Date(startDate.setHours(10, 0)), available: true },
                      { startTime: new Date(startDate.setHours(10, 0)), endTime: new Date(startDate.setHours(11, 0)), available: true },
                      { startTime: new Date(startDate.setHours(11, 0)), endTime: new Date(startDate.setHours(12, 0)), available: true },
                      { startTime: new Date(startDate.setHours(13, 0)), endTime: new Date(startDate.setHours(14, 0)), available: true },
                      { startTime: new Date(startDate.setHours(14, 0)), endTime: new Date(startDate.setHours(15, 0)), available: true },
                      { startTime: new Date(startDate.setHours(15, 0)), endTime: new Date(startDate.setHours(16, 0)), available: true },
                      { startTime: new Date(startDate.setHours(16, 0)), endTime: new Date(startDate.setHours(17, 0)), available: true },
                    ]}
                    onSlotSelect={handleTimeSlotSelect}
                  />
                </DialogContent>
              </Dialog>
            )}
          </div>
        </div>
      </div>
    </>
  );
};
