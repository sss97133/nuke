
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface DisplaySettingsProps {
  distanceUnit: string;
  currency: string;
  defaultGarageView: string;
  onDistanceUnitChange: (value: string) => void;
  onCurrencyChange: (value: string) => void;
  onDefaultGarageViewChange: (value: string) => void;
}

export const DisplaySettings = ({
  distanceUnit,
  currency,
  defaultGarageView,
  onDistanceUnitChange,
  onCurrencyChange,
  onDefaultGarageViewChange,
}: DisplaySettingsProps) => {
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Display Settings</h2>
      <div className="grid gap-4">
        <div className="space-y-2">
          <Label>Distance Unit</Label>
          <Select value={distanceUnit} onValueChange={onDistanceUnitChange}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="miles">Miles</SelectItem>
              <SelectItem value="kilometers">Kilometers</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Currency</Label>
          <Select value={currency} onValueChange={onCurrencyChange}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="USD">USD ($)</SelectItem>
              <SelectItem value="EUR">EUR (€)</SelectItem>
              <SelectItem value="GBP">GBP (£)</SelectItem>
              <SelectItem value="CAD">CAD ($)</SelectItem>
              <SelectItem value="AUD">AUD ($)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Default Garage View</Label>
          <Select value={defaultGarageView} onValueChange={onDefaultGarageViewChange}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="list">List</SelectItem>
              <SelectItem value="grid">Grid</SelectItem>
              <SelectItem value="map">Map</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
};

