
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

interface AppearanceSettingsProps {
  compactViewEnabled: boolean;
  onCompactViewChange: (checked: boolean) => void;
}

export const AppearanceSettings = ({
  compactViewEnabled,
  onCompactViewChange,
}: AppearanceSettingsProps) => {
  return (
    <div className="space-y-2">
      <h2 className="text-xl font-semibold">Appearance</h2>
      <div className="flex items-center justify-between">
        <Label htmlFor="compact">Compact View</Label>
        <Switch
          id="compact"
          checked={compactViewEnabled}
          onCheckedChange={onCompactViewChange}
        />
      </div>
    </div>
  );
};
