import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Camera, Upload, RefreshCw } from "lucide-react";

interface VinCaptureProps {
  onVinData: (data: any) => void;
}

export const VinCapture = ({ onVinData }: VinCaptureProps) => {
  const { toast } = useToast();
  const [isCapturing, setIsCapturing] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setIsCapturing(true);
      }
    } catch (error) {
      toast({
        title: "Camera Error",
        description: "Could not access camera. Please check permissions.",
        variant: "destructive",
      });
    }
  };

  const captureImage = () => {
    if (videoRef.current && canvasRef.current) {
      const context = canvasRef.current.getContext('2d');
      if (context) {
        context.drawImage(videoRef.current, 0, 0, 640, 480);
        canvasRef.current.toBlob(async (blob) => {
          if (blob) {
            await processVin(blob);
          }
        });
      }
      stopCamera();
    }
  };

  const stopCamera = () => {
    if (videoRef.current?.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      setIsCapturing(false);
    }
  };

  const processVin = async (imageBlob: Blob) => {
    setIsProcessing(true);
    try {
      const formData = new FormData();
      formData.append('image', imageBlob);

      const { data, error } = await supabase.functions.invoke('process-vin', {
        body: formData,
      });

      if (error) throw error;

      if (data.vin) {
        onVinData(data);
        toast({
          title: "VIN Processed",
          description: `Successfully extracted VIN: ${data.vin}`,
        });
      } else {
        toast({
          title: "VIN Not Found",
          description: "Could not detect a valid VIN in the image.",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Processing Error",
        description: "Failed to process VIN image.",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      await processVin(file);
    }
  };

  return (
    <div className="space-y-4 p-4 border border-gray-200 bg-white">
      <div className="flex gap-4">
        <Button
          onClick={startCamera}
          disabled={isCapturing}
          className="font-mono text-sm"
        >
          <Camera className="mr-2 h-4 w-4" />
          Scan VIN
        </Button>
        <Input
          type="file"
          accept="image/*"
          onChange={handleFileUpload}
          className="font-mono text-sm"
        />
      </div>

      {isCapturing && (
        <div className="relative">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            className="w-full max-w-lg mx-auto"
          />
          <div className="absolute inset-0 border-2 border-dashed border-primary opacity-50 pointer-events-none" />
          <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 text-center text-white bg-black bg-opacity-50 p-2 rounded">
            <p className="font-mono text-sm">Position VIN in frame</p>
          </div>
          <Button
            onClick={captureImage}
            className="absolute bottom-4 left-1/2 transform -translate-x-1/2 font-mono text-sm"
          >
            Capture
          </Button>
        </div>
      )}

      <canvas ref={canvasRef} className="hidden" width="640" height="480" />

      {isProcessing && (
        <div className="flex items-center justify-center p-4">
          <RefreshCw className="animate-spin mr-2" />
          <span className="font-mono text-sm">Processing VIN...</span>
        </div>
      )}
    </div>
  );
};