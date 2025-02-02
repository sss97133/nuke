import { useState } from "react";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import QRCode from "react-qr-code";
import { useToast } from "@/hooks/use-toast";

interface PhotoCaptureProps {
  onPhotoCapture: (file: File) => Promise<void>;
  onSkip: () => void;
}

export const PhotoCapture = ({ onPhotoCapture, onSkip }: PhotoCaptureProps) => {
  const [showQR, setShowQR] = useState(false);
  const { toast } = useToast();
  const connectionUrl = `${window.location.origin}/mobile-capture?session=${Date.now()}`;

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      await onPhotoCapture(file);
      toast({
        title: "Photo uploaded successfully",
        description: "You can continue with the inventory form.",
      });
    }
  };

  const handleConnectPhone = () => {
    setShowQR(true);
    // Create a unique session ID
    const sessionId = Date.now().toString();
    const mobileUrl = `${window.location.origin}/mobile-capture?session=${sessionId}`;
    
    // Open mobile capture window
    const mobileWindow = window.open(mobileUrl, 'MobileCapture', 'width=400,height=600');
    
    // Listen for messages from mobile window
    const messageHandler = async (event: MessageEvent) => {
      if (event.data?.type === 'PHOTO_CAPTURED' && event.data?.photo) {
        try {
          const response = await fetch(event.data.photo);
          const blob = await response.blob();
          const file = new File([blob], `mobile-capture-${sessionId}.jpg`, { type: 'image/jpeg' });
          
          await onPhotoCapture(file);
          setShowQR(false);
          
          toast({
            title: "Photo captured successfully",
            description: "You can continue with the inventory form.",
          });
          
          // Clean up
          window.removeEventListener('message', messageHandler);
          mobileWindow?.close();
        } catch (error) {
          toast({
            title: "Error capturing photo",
            description: "Please try again or use file upload instead.",
            variant: "destructive",
          });
        }
      }
    };

    window.addEventListener('message', messageHandler);
  };

  return (
    <div className="space-y-6">
      <div className="text-center space-y-4">
        <h3 className="text-lg font-semibold">Add Item Photo</h3>
        <p className="text-sm text-muted-foreground">
          Take a photo of the item or upload one from your device
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-4 p-6 border rounded-lg bg-muted/50">
          <h4 className="font-medium">Upload from Device</h4>
          <input
            type="file"
            accept="image/*"
            onChange={handleFileChange}
            className="w-full"
          />
        </div>

        <div className="space-y-4 p-6 border rounded-lg bg-muted/50">
          <h4 className="font-medium">Use Smartphone Camera</h4>
          <Button onClick={handleConnectPhone} className="w-full">
            Connect Phone
          </Button>
          
          {showQR && (
            <div className="mt-4 p-4 bg-white rounded-lg flex flex-col items-center">
              <QRCode value={connectionUrl} size={200} />
              <p className="text-xs text-center mt-2">
                Scan with your phone's camera
              </p>
            </div>
          )}
        </div>
      </div>

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="outline" className="w-full">
            Skip for now
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Skip Photo Upload?</AlertDialogTitle>
            <AlertDialogDescription>
              You can always add a photo later during the inventory process.
              Are you sure you want to continue without a photo?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onSkip}>
              Continue without photo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};