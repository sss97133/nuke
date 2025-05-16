
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

interface BasicInfoStepProps {
  name: string;
  symbol: string;
  onNameChange: (value: string) => void;
  onSymbolChange: (value: string) => void;
}

const BasicInfoStep = ({ name, symbol, onNameChange, onSymbolChange }: BasicInfoStepProps) => {
  return (
    <div className="space-y-4 py-2">
      <div className="space-y-2">
        <Label htmlFor="token-name">Token Name</Label>
        <Input
          id="token-name"
          placeholder="e.g., My Awesome Token"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
        />
        <p className="text-sm text-muted-foreground">
          The full name of your token (e.g., "Bitcoin", "Ethereum")
        </p>
      </div>
      
      <div className="space-y-2">
        <Label htmlFor="token-symbol">Token Symbol</Label>
        <Input
          id="token-symbol"
          placeholder="e.g., MAT"
          value={symbol}
          onChange={(e) => onSymbolChange(e.target.value.toUpperCase())}
          maxLength={10}
        />
        <p className="text-sm text-muted-foreground">
          A short abbreviation for your token (e.g., "BTC", "ETH")
        </p>
      </div>
    </div>
  );
};

export default BasicInfoStep;
