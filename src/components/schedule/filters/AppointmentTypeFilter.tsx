
import { useState, useEffect } from 'react';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';

interface AppointmentTypeFilterProps {
  initialTypes: string[];
  onChange: (types: string[]) => void;
}

export const AppointmentTypeFilter = ({ initialTypes, onChange }: AppointmentTypeFilterProps) => {
  const [appointmentTypes, setAppointmentTypes] = useState<string[]>(initialTypes);

  useEffect(() => {
    onChange(appointmentTypes);
  }, [appointmentTypes, onChange]);

  const handleTypeChange = (type: string, checked: boolean) => {
    if (checked) {
      setAppointmentTypes([...appointmentTypes, type]);
    } else {
      setAppointmentTypes(appointmentTypes.filter(t => t !== type));
    }
  };

  return (
    <div>
      <h3 className="text-lg font-medium mb-2">Appointment Type</h3>
      <div className="space-y-2">
        <div className="flex items-center space-x-2">
          <Checkbox 
            id="type-maintenance" 
            checked={appointmentTypes.includes('maintenance')}
            onCheckedChange={(checked) => 
              handleTypeChange('maintenance', checked as boolean)
            }
          />
          <Label htmlFor="type-maintenance">Maintenance</Label>
        </div>
        <div className="flex items-center space-x-2">
          <Checkbox 
            id="type-repair" 
            checked={appointmentTypes.includes('repair')}
            onCheckedChange={(checked) => 
              handleTypeChange('repair', checked as boolean)
            }
          />
          <Label htmlFor="type-repair">Repair</Label>
        </div>
        <div className="flex items-center space-x-2">
          <Checkbox 
            id="type-inspection" 
            checked={appointmentTypes.includes('inspection')}
            onCheckedChange={(checked) => 
              handleTypeChange('inspection', checked as boolean)
            }
          />
          <Label htmlFor="type-inspection">Inspection</Label>
        </div>
        <div className="flex items-center space-x-2">
          <Checkbox 
            id="type-other" 
            checked={appointmentTypes.includes('other')}
            onCheckedChange={(checked) => 
              handleTypeChange('other', checked as boolean)
            }
          />
          <Label htmlFor="type-other">Other</Label>
        </div>
      </div>
    </div>
  );
};
