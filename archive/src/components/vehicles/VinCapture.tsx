import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Camera, Upload } from "lucide-react";
import { CameraInterface } from "./vin-capture/CameraInterface";
import { ProcessingStatus } from "./vin-capture/ProcessingStatus";
import { ConfidenceDisplay } from "./vin-capture/ConfidenceDisplay";
import { useVinCapture } from "./vin-capture/useVinCapture";

interface VinData {
  vin: string;
  make: string;
  model: string;
  year: number;
  trim: string;
  engine: string;
  transmission: string;
  bodyStyle: string;
  color: string;
  metadata: Record<string, unknown>;
}

interface VinCaptureProps {
  onVinData: (data: VinData) => void;
}

export const VinCapture = ({ onVinData }: VinCaptureProps) => {
  const {
    isCapturing,
    isProcessing,
    processingStep,
    progress,
    confidence,
    videoRef,
    canvasRef,
    startCamera,
    stopCamera,
    processVin,
  } = useVinCapture(onVinData);

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
        <CameraInterface
          onCapture={captureImage}
          isProcessing={isProcessing}
          videoRef={videoRef}
        />
      )}

      <canvas ref={canvasRef} className="hidden" width="640" height="480" />

      {isProcessing && (
        <ProcessingStatus
          processingStep={processingStep}
          progress={progress}
        />
      )}

      <ConfidenceDisplay confidence={confidence} />
    </div>
  );
};