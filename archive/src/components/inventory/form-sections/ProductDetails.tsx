import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

interface ProductDetailsProps {
  manufacturer: string;
  modelNumber: string;
  serialNumber: string;
  quantity: number;
  onManufacturerChange: (value: string) => void;
  onModelNumberChange: (value: string) => void;
  onSerialNumberChange: (value: string) => void;
  onQuantityChange: (value: number) => void;
}

export const ProductDetails = ({
  manufacturer,
  modelNumber,
  serialNumber,
  quantity,
  onManufacturerChange,
  onModelNumberChange,
  onSerialNumberChange,
  onQuantityChange,
}: ProductDetailsProps) => {
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-[#283845]">Product Details</h3>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="manufacturer">Manufacturer</Label>
          <Input
            id="manufacturer"
            value={manufacturer}
            onChange={(e) => onManufacturerChange(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="modelNumber">Model Number</Label>
          <Input
            id="modelNumber"
            value={modelNumber}
            onChange={(e) => onModelNumberChange(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="serialNumber">Serial Number</Label>
          <Input
            id="serialNumber"
            value={serialNumber}
            onChange={(e) => onSerialNumberChange(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="quantity">Quantity *</Label>
          <Input
            id="quantity"
            type="number"
            value={quantity}
            onChange={(e) => onQuantityChange(parseInt(e.target.value))}
            required
          />
        </div>
      </div>
    </div>
  );
};