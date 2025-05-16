
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface ThemeSettingsProps {
  theme: string;
  onThemeChange: (value: string) => void;
}

export const ThemeSettings = ({
  theme,
  onThemeChange,
}: ThemeSettingsProps) => {
  return (
    <div className="space-y-2">
      <h2 className="text-xl font-semibold">Theme Settings</h2>
      <div className="space-y-2">
        <Label htmlFor="theme">Application Theme</Label>
        <Select value={theme} onValueChange={onThemeChange}>
          <SelectTrigger id="theme">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="system">System Default</SelectItem>
            <SelectItem value="light">Light</SelectItem>
            <SelectItem value="dark">Dark</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
};
