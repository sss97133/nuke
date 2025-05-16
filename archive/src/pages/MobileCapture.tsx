import { useState, useRef } from 'react';
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";

export const MobileCapture = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const { toast } = useToast();

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'environment' }
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setIsCapturing(true);
      }
    } catch (error) {
      toast({
        title: "Camera Error",
        description: "Could not access camera",
        variant: "destructive"
      });
    }
  };

  const capturePhoto = () => {
    if (!videoRef.current) return;

    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    
    const context = canvas.getContext('2d');
    if (!context) return;

    context.drawImage(videoRef.current, 0, 0);
    
    canvas.toBlob((blob) => {
      if (!blob) return;
      
      // Send the photo back to the main window
      window.opener?.postMessage({ 
        type: 'PHOTO_CAPTURED',
        photo: URL.createObjectURL(blob)
      }, '*');
      
      // Close this window
      window.close();
    }, 'image/jpeg');
  };

  return (
    <div className="p-4 max-w-md mx-auto space-y-4">
      <h1 className="text-lg font-semibold text-center">Capture Item Photo</h1>
      
      {isCapturing ? (
        <div className="space-y-4">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            className="w-full aspect-square object-cover rounded-lg"
          />
          <Button onClick={capturePhoto} className="w-full">
            Take Photo
          </Button>
        </div>
      ) : (
        <Button onClick={startCamera} className="w-full">
          Start Camera
        </Button>
      )}
    </div>
  );
};