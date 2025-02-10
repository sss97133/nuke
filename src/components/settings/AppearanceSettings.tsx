
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useTheme } from "next-themes";

interface AppearanceSettingsProps {
  compactViewEnabled: boolean;
  onCompactViewChange: (checked: boolean) => void;
}

export const AppearanceSettings = ({
  compactViewEnabled,
  onCompactViewChange,
}: AppearanceSettingsProps) => {
  const { theme, setTheme } = useTheme();

  return (
    <div className="space-y-2">
      <h2 className="text-xl font-semibold">Appearance</h2>
      <div className="flex items-center justify-between">
        <Label htmlFor="theme">Dark Mode</Label>
        <Switch
          id="theme"
          checked={theme === 'dark'}
          onCheckedChange={(checked) => {
            const newTheme = checked ? 'dark' : 'light';
            setTheme(newTheme);
          }}
        />
      </div>
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
