
import { useState, useEffect } from 'react';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';

interface StatusFilterProps {
  initialStatuses: string[];
  onChange: (statuses: string[]) => void;
}

export const StatusFilter = ({ initialStatuses, onChange }: StatusFilterProps) => {
  const [statuses, setStatuses] = useState<string[]>(initialStatuses);

  useEffect(() => {
    onChange(statuses);
  }, [statuses, onChange]);

  const handleStatusChange = (status: string, checked: boolean) => {
    if (checked) {
      setStatuses([...statuses, status]);
    } else {
      setStatuses(statuses.filter(s => s !== status));
    }
  };

  return (
    <div>
      <h3 className="text-lg font-medium mb-2">Status</h3>
      <div className="space-y-2">
        <div className="flex items-center space-x-2">
          <Checkbox 
            id="status-scheduled" 
            checked={statuses.includes('scheduled')}
            onCheckedChange={(checked) => 
              handleStatusChange('scheduled', checked as boolean)
            }
          />
          <Label htmlFor="status-scheduled">Scheduled</Label>
        </div>
        <div className="flex items-center space-x-2">
          <Checkbox 
            id="status-in-progress" 
            checked={statuses.includes('in-progress')}
            onCheckedChange={(checked) => 
              handleStatusChange('in-progress', checked as boolean)
            }
          />
          <Label htmlFor="status-in-progress">In Progress</Label>
        </div>
        <div className="flex items-center space-x-2">
          <Checkbox 
            id="status-completed" 
            checked={statuses.includes('completed')}
            onCheckedChange={(checked) => 
              handleStatusChange('completed', checked as boolean)
            }
          />
          <Label htmlFor="status-completed">Completed</Label>
        </div>
        <div className="flex items-center space-x-2">
          <Checkbox 
            id="status-cancelled" 
            checked={statuses.includes('cancelled')}
            onCheckedChange={(checked) => 
              handleStatusChange('cancelled', checked as boolean)
            }
          />
          <Label htmlFor="status-cancelled">Cancelled</Label>
        </div>
      </div>
    </div>
  );
};
