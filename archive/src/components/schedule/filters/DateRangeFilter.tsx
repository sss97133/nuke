
import { DateRange } from 'react-day-picker';
import { DatePickerWithRange } from '@/components/service-history/DatePickerWithRange';

interface DateRangeFilterProps {
  dateRange: DateRange | undefined;
  setDateRange: (range: DateRange | undefined) => void;
}

export const DateRangeFilter = ({ dateRange, setDateRange }: DateRangeFilterProps) => {
  return (
    <div>
      <h3 className="text-lg font-medium mb-2">Date Range</h3>
      <DatePickerWithRange
        date={dateRange}
        onDateChange={setDateRange}
      />
    </div>
  );
};
