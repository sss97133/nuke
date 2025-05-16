
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

interface AutoSaveSettingsProps {
  autoSaveEnabled: boolean;
  onAutoSaveChange: (checked: boolean) => void;
}

export const AutoSaveSettings = ({
  autoSaveEnabled,
  onAutoSaveChange,
}: AutoSaveSettingsProps) => {
  return (
    <div className="space-y-2">
      <h2 className="text-xl font-semibold">Auto-Save</h2>
      <div className="flex items-center justify-between">
        <Label htmlFor="autosave">Enable Auto-Save</Label>
        <Switch
          id="autosave"
          checked={autoSaveEnabled}
          onCheckedChange={onAutoSaveChange}
        />
      </div>
    </div>
  );
};
