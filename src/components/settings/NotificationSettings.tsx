
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

interface NotificationSettingsProps {
  notificationsEnabled: boolean;
  onNotificationsChange: (checked: boolean) => void;
}

export const NotificationSettings = ({
  notificationsEnabled,
  onNotificationsChange,
}: NotificationSettingsProps) => {
  return (
    <div className="space-y-2">
      <h2 className="text-xl font-semibold">Notifications</h2>
      <div className="flex items-center justify-between">
        <Label htmlFor="notifications">Enable Notifications</Label>
        <Switch
          id="notifications"
          checked={notificationsEnabled}
          onCheckedChange={onNotificationsChange}
        />
      </div>
    </div>
  );
};
