import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface BasicInformationProps {
  name: string;
  partNumber: string;
  onNameChange: (value: string) => void;
  onPartNumberChange: (value: string) => void;
}

export const BasicInformation = ({
  name,
  partNumber,
  onNameChange,
  onPartNumberChange,
}: BasicInformationProps) => {
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-[#283845]">Basic Information</h3>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="name">Item Name *</Label>
          <Input
            id="name"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="partNumber">Part Number</Label>
          <Input
            id="partNumber"
            value={partNumber}
            onChange={(e) => onPartNumberChange(e.target.value)}
          />
        </div>
      </div>
    </div>
  );
};