
import React from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Plus, Trash } from 'lucide-react';
import { PartItem } from '../../types';

interface PartsSectionProps {
  parts: PartItem[];
  newPart: PartItem;
  onNewPartChange: (part: Partial<PartItem>) => void;
  onAddPart: () => void;
  onRemovePart: (index: number) => void;
}

const PartsSection: React.FC<PartsSectionProps> = ({
  parts,
  newPart,
  onNewPartChange,
  onAddPart,
  onRemovePart
}) => {
  return (
    <div className="grid gap-2">
      <Label>Parts Used</Label>
      <div className="grid grid-cols-[1fr,80px,120px,40px] gap-2 items-end">
        <Input
          placeholder="Part name"
          value={newPart.name}
          onChange={(e) => onNewPartChange({ name: e.target.value })}
        />
        <Input
          type="number"
          min="1"
          placeholder="Qty"
          value={newPart.quantity}
          onChange={(e) => onNewPartChange({ quantity: parseInt(e.target.value) || 1 })}
        />
        <Input
          type="number"
          min="0"
          step="0.01"
          placeholder="Cost"
          value={newPart.cost}
          onChange={(e) => onNewPartChange({ cost: parseFloat(e.target.value) || 0 })}
        />
        <Button type="button" onClick={onAddPart} variant="outline" size="icon">
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {parts.length > 0 && (
        <div className="border rounded-md divide-y">
          {parts.map((part, index) => (
            <div key={index} className="flex justify-between items-center p-2">
              <div>
                <span className="font-medium">{part.name}</span>
                <span className="text-sm text-muted-foreground ml-2">
                  (Qty: {part.quantity}, Cost: ${part.cost.toFixed(2)})
                </span>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => onRemovePart(index)}
              >
                <Trash className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default PartsSection;
