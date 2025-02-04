import React from 'react';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

interface PropsSectionProps {
  props: {
    toolBox: boolean;
    carLift: boolean;
    car: boolean;
  };
  onPropsChange: (key: string, value: boolean) => void;
}

export const PropsSection = ({ props, onPropsChange }: PropsSectionProps) => {
  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="flex items-center justify-between">
        <Label htmlFor="toolBox">Tool Box</Label>
        <Switch
          id="toolBox"
          checked={props.toolBox}
          onCheckedChange={(checked) => onPropsChange('toolBox', checked)}
        />
      </div>
      <div className="flex items-center justify-between">
        <Label htmlFor="carLift">Car Lift</Label>
        <Switch
          id="carLift"
          checked={props.carLift}
          onCheckedChange={(checked) => onPropsChange('carLift', checked)}
        />
      </div>
      <div className="flex items-center justify-between">
        <Label htmlFor="car">Car</Label>
        <Switch
          id="car"
          checked={props.car}
          onCheckedChange={(checked) => onPropsChange('car', checked)}
        />
      </div>
    </div>
  );
};