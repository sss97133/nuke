import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

interface PriceFieldProps {
  purchasePrice: string;
  onPurchasePriceChange: (value: string) => void;
}

export const PriceField = ({
  purchasePrice,
  onPurchasePriceChange,
}: PriceFieldProps) => {
  return (
    <div className="space-y-2">
      <Label htmlFor="purchasePrice">Purchase Price</Label>
      <Input
        id="purchasePrice"
        type="number"
        step="0.01"
        value={purchasePrice}
        onChange={(e) => onPurchasePriceChange(e.target.value)}
      />
    </div>
  );
};