import React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { StudioDimensionsProps } from '@/types/studio';

export const StudioDimensions = ({ dimensions, onUpdate }: StudioDimensionsProps) => {
  return (
    <div className="grid grid-cols-3 gap-4">
      <div>
        <Label htmlFor="length">Length (ft)</Label>
        <Input
          id="length"
          type="number"
          value={dimensions.length}
          onChange={(e) => onUpdate({ ...dimensions, length: Number(e.target.value) })}
          placeholder="30"
        />
      </div>
      <div>
        <Label htmlFor="width">Width (ft)</Label>
        <Input
          id="width"
          type="number"
          value={dimensions.width}
          onChange={(e) => onUpdate({ ...dimensions, width: Number(e.target.value) })}
          placeholder="20"
        />
      </div>
      <div>
        <Label htmlFor="height">Height (ft)</Label>
        <Input
          id="height"
          type="number"
          value={dimensions.height}
          onChange={(e) => onUpdate({ ...dimensions, height: Number(e.target.value) })}
          placeholder="16"
        />
      </div>
    </div>
  );
};