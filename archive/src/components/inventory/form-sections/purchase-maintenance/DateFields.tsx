import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

interface DateFieldsProps {
  purchaseDate: string;
  warrantyExpiration: string;
  lastMaintenanceDate: string;
  nextMaintenanceDate: string;
  onPurchaseDateChange: (value: string) => void;
  onWarrantyExpirationChange: (value: string) => void;
  onLastMaintenanceDateChange: (value: string) => void;
  onNextMaintenanceDateChange: (value: string) => void;
}

export const DateFields = ({
  purchaseDate,
  warrantyExpiration,
  lastMaintenanceDate,
  nextMaintenanceDate,
  onPurchaseDateChange,
  onWarrantyExpirationChange,
  onLastMaintenanceDateChange,
  onNextMaintenanceDateChange,
}: DateFieldsProps) => {
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="purchaseDate">Purchase Date</Label>
        <Input
          id="purchaseDate"
          type="date"
          value={purchaseDate}
          onChange={(e) => onPurchaseDateChange(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="warrantyExpiration">Warranty Expiration</Label>
        <Input
          id="warrantyExpiration"
          type="date"
          value={warrantyExpiration}
          onChange={(e) => onWarrantyExpirationChange(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="lastMaintenanceDate">Last Maintenance</Label>
        <Input
          id="lastMaintenanceDate"
          type="date"
          value={lastMaintenanceDate}
          onChange={(e) => onLastMaintenanceDateChange(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="nextMaintenanceDate">Next Maintenance</Label>
        <Input
          id="nextMaintenanceDate"
          type="date"
          value={nextMaintenanceDate}
          onChange={(e) => onNextMaintenanceDateChange(e.target.value)}
        />
      </div>
    </>
  );
};