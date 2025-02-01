import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

interface PurchaseMaintenanceProps {
  purchaseDate: string;
  purchasePrice: string;
  warrantyExpiration: string;
  lastMaintenanceDate: string;
  nextMaintenanceDate: string;
  onPurchaseDateChange: (value: string) => void;
  onPurchasePriceChange: (value: string) => void;
  onWarrantyExpirationChange: (value: string) => void;
  onLastMaintenanceDateChange: (value: string) => void;
  onNextMaintenanceDateChange: (value: string) => void;
}

export const PurchaseMaintenance = ({
  purchaseDate,
  purchasePrice,
  warrantyExpiration,
  lastMaintenanceDate,
  nextMaintenanceDate,
  onPurchaseDateChange,
  onPurchasePriceChange,
  onWarrantyExpirationChange,
  onLastMaintenanceDateChange,
  onNextMaintenanceDateChange,
}: PurchaseMaintenanceProps) => {
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-[#283845]">Purchase & Maintenance</h3>
      <div className="grid grid-cols-2 gap-4">
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
          <Label htmlFor="purchasePrice">Purchase Price</Label>
          <Input
            id="purchasePrice"
            type="number"
            step="0.01"
            value={purchasePrice}
            onChange={(e) => onPurchasePriceChange(e.target.value)}
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
      </div>
    </div>
  );
};