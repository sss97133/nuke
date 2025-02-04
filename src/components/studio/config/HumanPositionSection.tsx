import React from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';

interface HumanPositionSectionProps {
  register: any;
}

export const HumanPositionSection = ({ register }: HumanPositionSectionProps) => {
  return (
    <div className="grid grid-cols-3 gap-4">
      <div>
        <Label htmlFor="human-x">X Position</Label>
        <Input
          id="human-x"
          type="number"
          {...register('humanPosition.x', { required: true })}
          placeholder="0"
        />
      </div>
      <div>
        <Label htmlFor="human-y">Y Position</Label>
        <Input
          id="human-y"
          type="number"
          {...register('humanPosition.y', { required: true })}
          placeholder="0"
        />
      </div>
      <div>
        <Label htmlFor="human-z">Z Position</Label>
        <Input
          id="human-z"
          type="number"
          {...register('humanPosition.z', { required: true })}
          placeholder="0"
        />
      </div>
    </div>
  );
};