import { Button } from "@/components/ui/button";
import { Camera } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface ReceiptData {
  id: string;
  date: string;
  total: number;
  items: Array<{
    description: string;
    quantity: number;
    price: number;
    total: number;
  }>;
  vendor: string;
  location: string;
  metadata: Record<string, unknown>;
}

interface ReceiptScannerProps {
  onScanComplete: (data: ReceiptData) => void;
}

export const ReceiptScanner = ({ onScanComplete }: ReceiptScannerProps) => {
  const { toast } = useToast();

  const handleScanReceipt = () => {
    const captureWindow = window.open('/mobile-capture', 'Mobile Capture', 'width=400,height=600');

    window.addEventListener('message', (event) => {
      if (event.data.type === 'PHOTO_CAPTURED') {
        processReceipt(event.data.photo);
      }
    });
  };

  const processReceipt = async (photoUrl: string) => {
    try {
      const response = await fetch(photoUrl);
      const blob = await response.blob();
      const formData = new FormData();
      formData.append('file', blob, 'receipt.jpg');

      const { data, error } = await fetch('/functions/v1/analyze-inventory-image', {
        method: 'POST',
        body: formData,
      }).then(res => res.json());

      if (error) throw error;

      onScanComplete(data);
      
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
    <Button 
      onClick={handleScanReceipt}
      variant="outline"
      className="flex items-center gap-2"
    >
      <Camera className="w-4 h-4" />
      Scan Receipt
    </Button>
  );
};