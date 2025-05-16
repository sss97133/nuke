
import React, { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PartItem } from './types';
import { Plus, Trash, Package } from 'lucide-react';

interface PartsManagementProps {
  parts: PartItem[];
  onChange: (parts: PartItem[]) => void;
}

const PartsManagement: React.FC<PartsManagementProps> = ({ parts, onChange }) => {
  const [newPart, setNewPart] = useState<PartItem>({ name: '', quantity: 1, cost: 0 });
  
  const addPart = () => {
    if (newPart.name.trim() === '') return;
    
    onChange([...parts, { ...newPart }]);
    setNewPart({ name: '', quantity: 1, cost: 0 });
  };

  const removePart = (index: number) => {
    onChange(parts.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-4">
      <Label className="flex items-center gap-2">
        <Package className="h-4 w-4" />
        Parts Management
      </Label>
      
      <div className="grid grid-cols-[1fr,80px,120px,40px] gap-2 items-end">
        <Input
          placeholder="Part name"
          value={newPart.name}
          onChange={(e) => setNewPart({ ...newPart, name: e.target.value })}
        />
        <Input
          type="number"
          min="1"
          placeholder="Qty"
          value={newPart.quantity}
          onChange={(e) => setNewPart({ ...newPart, quantity: parseInt(e.target.value) || 1 })}
        />
        <Input
          type="number"
          min="0"
          step="0.01"
          placeholder="Cost"
          value={newPart.cost}
          onChange={(e) => setNewPart({ ...newPart, cost: parseFloat(e.target.value) || 0 })}
        />
        <Button type="button" onClick={addPart} variant="outline" size="icon">
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
                onClick={() => removePart(index)}
              >
                <Trash className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          ))}
          <div className="p-2 text-sm font-medium text-right">
            Total: ${parts.reduce((sum, part) => sum + (part.cost * part.quantity), 0).toFixed(2)}
          </div>
        </div>
      )}
    </div>
  );
};

export default PartsManagement;
