import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Camera, Upload, RefreshCw, Search, Check, X, Database, LoaderCircle } from "lucide-react";

interface VinCaptureProps {
  onVinData: (data: any) => void;
}

export const VinCapture = ({ onVinData }: VinCaptureProps) => {
  const { toast } = useToast();
  const [isCapturing, setIsCapturing] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStep, setProcessingStep] = useState<string>("");
  const [progress, setProgress] = useState(0);
  const [confidence, setConfidence] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const updateProcessingStatus = (step: string, progressValue: number) => {
    setProcessingStep(step);
    setProgress(progressValue);
  };

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
    setProgress(0);
    try {
      // Image preprocessing
      updateProcessingStatus("Preprocessing image...", 20);
      await new Promise(resolve => setTimeout(resolve, 800));

      // OCR Processing
      updateProcessingStatus("Performing OCR analysis...", 40);
      const formData = new FormData();
      formData.append('image', imageBlob);

      // Pattern matching
      updateProcessingStatus("Matching VIN patterns...", 60);
      await new Promise(resolve => setTimeout(resolve, 800));

      // Database verification
      updateProcessingStatus("Verifying with database...", 80);
      const { data, error } = await supabase.functions.invoke('process-vin', {
        body: formData,
      });

      if (error) throw error;

      // Final verification
      updateProcessingStatus("Completing verification...", 100);
      await new Promise(resolve => setTimeout(resolve, 500));

      if (data.vin) {
        setConfidence(90);
        onVinData(data);
        toast({
          title: "VIN Processed Successfully",
          description: `Extracted VIN: ${data.vin} (${confidence}% confidence)`,
        });
      } else {
        setConfidence(0);
        toast({
          title: "VIN Not Found",
          description: "Could not detect a valid VIN in the image.",
          variant: "destructive",
        });
      }
    } catch (error) {
      setConfidence(0);
      toast({
        title: "Processing Error",
        description: "Failed to process VIN image.",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
      setProcessingStep("");
      setProgress(0);
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      await processVin(file);
    }
  };

  return (
    <div className="space-y-4 p-4 border border-gray-200 bg-white rounded-lg">
      <div className="flex gap-4">
        <Button
          onClick={startCamera}
          disabled={isCapturing || isProcessing}
          className="font-mono text-sm"
        >
          <Camera className="mr-2 h-4 w-4" />
          Scan VIN
        </Button>
        <Input
          type="file"
          accept="image/*"
          onChange={handleFileUpload}
          disabled={isProcessing}
          className="font-mono text-sm"
        />
      </div>

      {isCapturing && (
        <div className="relative">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            className="w-full max-w-lg mx-auto rounded-lg"
          />
          <div className="absolute inset-0 border-2 border-dashed border-primary opacity-50 pointer-events-none rounded-lg" />
          <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 text-center text-white bg-black bg-opacity-50 p-2 rounded">
            <p className="font-mono text-sm">Position VIN in frame</p>
          </div>
          <Button
            onClick={captureImage}
            disabled={isProcessing}
            className="absolute bottom-4 left-1/2 transform -translate-x-1/2 font-mono text-sm"
          >
            Capture
          </Button>
        </div>
      )}

      <canvas ref={canvasRef} className="hidden" width="640" height="480" />

      {isProcessing && (
        <div className="space-y-4 animate-fade-in">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <LoaderCircle className="animate-spin h-4 w-4" />
              <span className="font-mono text-sm">{processingStep}</span>
            </div>
            <span className="font-mono text-sm">{progress}%</span>
          </div>
          <Progress value={progress} className="h-2" />
          
          <div className="flex justify-between items-center text-sm font-mono">
            <div className="flex items-center space-x-2">
              {progress >= 20 && <Check className="h-4 w-4 text-green-500" />}
              <span>Image</span>
            </div>
            <div className="flex items-center space-x-2">
              {progress >= 40 && <Search className="h-4 w-4 text-blue-500" />}
              <span>OCR</span>
            </div>
            <div className="flex items-center space-x-2">
              {progress >= 60 && <Database className="h-4 w-4 text-purple-500" />}
              <span>Match</span>
            </div>
            <div className="flex items-center space-x-2">
              {progress >= 100 ? 
                <Check className="h-4 w-4 text-green-500" /> : 
                (progress >= 80 ? <LoaderCircle className="animate-spin h-4 w-4" /> : null)
              }
              <span>Verify</span>
            </div>
          </div>
        </div>
      )}

      {confidence > 0 && !isProcessing && (
        <div className="flex items-center justify-between p-2 bg-green-50 rounded-lg animate-fade-in">
          <div className="flex items-center space-x-2">
            <Check className="h-4 w-4 text-green-500" />
            <span className="font-mono text-sm">VIN Match Found</span>
          </div>
          <span className="font-mono text-sm text-green-600">{confidence}% confidence</span>
        </div>
      )}
    </div>
  );
};