import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Camera } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";

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
  const { toast } = useToast();

  const handleScanReceipt = () => {
    // Open a new window for mobile capture
    const captureWindow = window.open('/mobile-capture', 'Mobile Capture', 'width=400,height=600');

    // Listen for the captured photo from the mobile window
    window.addEventListener('message', (event) => {
      if (event.data.type === 'PHOTO_CAPTURED') {
        // Process the captured receipt image
        processReceipt(event.data.photo);
      }
    });
  };

  const processReceipt = async (photoUrl: string) => {
    try {
      const response = await fetch(photoUrl);
      const blob = await response.blob();
      
      // Create a FormData object to send the image
      const formData = new FormData();
      formData.append('file', blob, 'receipt.jpg');

      // Call the analyze-inventory-image function
      const { data, error } = await fetch('/functions/v1/analyze-inventory-image', {
        method: 'POST',
        body: formData,
      }).then(res => res.json());

      if (error) throw error;

      // Update form with receipt data if available
      if (data?.purchaseDate) {
        onPurchaseDateChange(data.purchaseDate);
      }
      if (data?.purchasePrice) {
        onPurchasePriceChange(data.purchasePrice);
      }

      toast({
        title: "Receipt scanned successfully",
        description: "The form has been updated with the receipt information.",
      });

    } catch (error) {
      console.error('Error processing receipt:', error);
      toast({
        title: "Error scanning receipt",
        description: "Please try again or enter the information manually.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-[#283845]">Purchase & Maintenance</h3>
        <Button 
          onClick={handleScanReceipt}
          variant="outline"
          className="flex items-center gap-2"
        >
          <Camera className="w-4 h-4" />
          Scan Receipt
        </Button>
      </div>
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