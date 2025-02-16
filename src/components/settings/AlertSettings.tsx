
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

interface AlertSettingsProps {
  serviceRemindersEnabled: boolean;
  inventoryAlertsEnabled: boolean;
  priceAlertsEnabled: boolean;
  onServiceRemindersChange: (checked: boolean) => void;
  onInventoryAlertsChange: (checked: boolean) => void;
  onPriceAlertsChange: (checked: boolean) => void;
}

export const AlertSettings = ({
  serviceRemindersEnabled,
  inventoryAlertsEnabled,
  priceAlertsEnabled,
  onServiceRemindersChange,
  onInventoryAlertsChange,
  onPriceAlertsChange,
}: AlertSettingsProps) => {
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Alert Settings</h2>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Label htmlFor="service-reminders">Service Reminders</Label>
          <Switch
            id="service-reminders"
            checked={serviceRemindersEnabled}
            onCheckedChange={onServiceRemindersChange}
          />
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="inventory-alerts">Inventory Alerts</Label>
          <Switch
            id="inventory-alerts"
            checked={inventoryAlertsEnabled}
            onCheckedChange={onInventoryAlertsChange}
          />
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="price-alerts">Price Alerts</Label>
          <Switch
            id="price-alerts"
            checked={priceAlertsEnabled}
            onCheckedChange={onPriceAlertsChange}
          />
        </div>
      </div>
    </div>
  );
};

