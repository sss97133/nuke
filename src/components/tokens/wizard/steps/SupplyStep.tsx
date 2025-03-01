
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";

interface SupplyStepProps {
  totalSupply: number;
  decimals: number;
  onTotalSupplyChange: (value: number) => void;
  onDecimalsChange: (value: number) => void;
}

const SupplyStep = ({ 
  totalSupply, 
  decimals, 
  onTotalSupplyChange, 
  onDecimalsChange 
}: SupplyStepProps) => {
  return (
    <div className="space-y-4 py-2">
      <div className="space-y-2">
        <Label htmlFor="token-supply">Total Supply</Label>
        <Input
          id="token-supply"
          type="number"
          placeholder="e.g., 1000000"
          value={totalSupply || ''}
          onChange={(e) => onTotalSupplyChange(Number(e.target.value))}
          min={1}
        />
        <p className="text-sm text-muted-foreground">
          The total number of tokens that will ever exist
        </p>
      </div>
      
      <div className="space-y-2">
        <Label htmlFor="token-decimals">Decimals</Label>
        <div className="flex items-center space-x-2">
          <Slider
            id="token-decimals"
            value={[decimals]}
            min={0}
            max={18}
            step={1}
            onValueChange={(value) => onDecimalsChange(value[0])}
            className="flex-1"
          />
          <span className="w-12 text-center">{decimals}</span>
        </div>
        <p className="text-sm text-muted-foreground">
          Divisibility of your token (e.g., 18 decimals means 1 token can be divided into 10^18 units)
        </p>
      </div>
    </div>
  );
};

export default SupplyStep;
