
import React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface DimensionsFormProps {
  length: string;
  width: string;
  height: string;
  handleDimensionChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export const DimensionsForm: React.FC<DimensionsFormProps> = ({
  length,
  width,
  height,
  handleDimensionChange
}) => {
  return (
    <div>
      <h3 className="text-lg font-medium mb-4">Studio Dimensions</h3>
      <div className="grid grid-cols-3 gap-4">
        <div>
          <Label htmlFor="length">Length (feet)</Label>
          <Input
            id="length"
            name="length"
            type="number"
            value={length}
            onChange={handleDimensionChange}
            min="1"
            max="100"
          />
        </div>
        <div>
          <Label htmlFor="width">Width (feet)</Label>
          <Input
            id="width"
            name="width"
            type="number"
            value={width}
            onChange={handleDimensionChange}
            min="1"
            max="100"
          />
        </div>
        <div>
          <Label htmlFor="height">Height (feet)</Label>
          <Input
            id="height"
            name="height"
            type="number"
            value={height}
            onChange={handleDimensionChange}
            min="1"
            max="50"
          />
        </div>
      </div>
    </div>
  );
};
