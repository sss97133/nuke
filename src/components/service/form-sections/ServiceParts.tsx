import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, X } from "lucide-react";

interface Part {
  name: string;
  quantity: number;
}

interface ServicePartsProps {
  parts: Part[];
  onPartsChange: (parts: Part[]) => void;
}

export const ServiceParts = ({ parts, onPartsChange }: ServicePartsProps) => {
  const [newPart, setNewPart] = useState({ name: "", quantity: 1 });

  const addPart = () => {
    if (newPart.name.trim()) {
      onPartsChange([...parts, { ...newPart }]);
      setNewPart({ name: "", quantity: 1 });
    }
  };

  const removePart = (index: number) => {
    const updatedParts = parts.filter((_, i) => i !== index);
    onPartsChange(updatedParts);
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-[1fr,auto,auto] gap-2 items-end">
        <div>
          <Label htmlFor="partName">Part Name</Label>
          <Input
            id="partName"
            value={newPart.name}
            onChange={(e) => setNewPart({ ...newPart, name: e.target.value })}
            placeholder="Enter part name"
          />
        </div>
        <div>
          <Label htmlFor="quantity">Qty</Label>
          <Input
            id="quantity"
            type="number"
            min="1"
            value={newPart.quantity}
            onChange={(e) => setNewPart({ ...newPart, quantity: parseInt(e.target.value) || 1 })}
            className="w-20"
          />
        </div>
        <Button onClick={addPart} type="button" className="mb-0.5">
          <Plus className="w-4 h-4" />
        </Button>
      </div>

      <div className="space-y-2">
        {parts.map((part, index) => (
          <div key={index} className="flex items-center justify-between bg-muted p-2 rounded">
            <span>
              {part.name} (x{part.quantity})
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => removePart(index)}
              className="h-8 w-8 p-0"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
};