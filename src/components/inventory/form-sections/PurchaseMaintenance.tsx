import { ReceiptScanner } from "./purchase-maintenance/ReceiptScanner";
import { DateFields } from "./purchase-maintenance/DateFields";
import { PriceField } from "./purchase-maintenance/PriceField";

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
  const handleScanComplete = (data: any) => {
    if (data?.purchaseDate) {
      onPurchaseDateChange(data.purchaseDate);
    }
    if (data?.purchasePrice) {
      onPurchasePriceChange(data.purchasePrice);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-[#283845]">Purchase & Maintenance</h3>
        <ReceiptScanner onScanComplete={handleScanComplete} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <DateFields
          purchaseDate={purchaseDate}
          warrantyExpiration={warrantyExpiration}
          lastMaintenanceDate={lastMaintenanceDate}
          nextMaintenanceDate={nextMaintenanceDate}
          onPurchaseDateChange={onPurchaseDateChange}
          onWarrantyExpirationChange={onWarrantyExpirationChange}
          onLastMaintenanceDateChange={onLastMaintenanceDateChange}
          onNextMaintenanceDateChange={onNextMaintenanceDateChange}
        />
        <PriceField
          purchasePrice={purchasePrice}
          onPurchasePriceChange={onPurchasePriceChange}
        />
      </div>
    </div>
  );
};