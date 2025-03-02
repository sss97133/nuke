
import React from 'react';
import { Label } from '@/components/ui/label';

interface TotalCostProps {
  totalCost: number;
}

const TotalCost: React.FC<TotalCostProps> = ({ totalCost }) => {
  return (
    <div className="border-t pt-4 mt-4">
      <div className="flex justify-between items-center">
        <Label className="text-lg font-semibold">Total Cost:</Label>
        <span className="text-lg font-bold">${totalCost.toFixed(2)}</span>
      </div>
    </div>
  );
};

export default TotalCost;
