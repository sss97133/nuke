import React from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';

interface DimensionsSectionProps {
  register: any;
}

export const DimensionsSection = ({ register }: DimensionsSectionProps) => {
  return (
    <div className="grid grid-cols-3 gap-4">
      <div>
        <Label htmlFor="length">Length (ft)</Label>
        <Input
          id="length"
          type="number"
          {...register('length', { required: true, min: 0 })}
          placeholder="30"
        />
      </div>
      <div>
        <Label htmlFor="width">Width (ft)</Label>
        <Input
          id="width"
          type="number"
          {...register('width', { required: true, min: 0 })}
          placeholder="20"
        />
      </div>
      <div>
        <Label htmlFor="height">Height (ft)</Label>
        <Input
          id="height"
          type="number"
          {...register('height', { required: true, min: 0 })}
          placeholder="16"
        />
      </div>
    </div>
  );
};