import { Button } from "@/components/ui/button";
import { Loader2, Upload } from "lucide-react";
import { AIResults } from "./photo-capture/AIResults";
import { ImagePreview } from "./photo-capture/ImagePreview";
import { usePhotoCapture } from "./photo-capture/usePhotoCapture";

interface PhotoCaptureProps {
  onPhotoCapture: (file: File) => Promise<void>;
  onSkip: () => void;
  isProcessing: boolean;
}

export const PhotoCapture = ({ onPhotoCapture, onSkip, isProcessing }: PhotoCaptureProps) => {
  const {
    preview,
    aiResults,
    isAnalyzing,
    handleFileChange,
  } = usePhotoCapture(onPhotoCapture);

  return (
    <div className="space-y-6">
      <div className="text-center space-y-4">
        <h3 className="text-lg font-semibold">Add Item Photo</h3>
        <p className="text-sm text-muted-foreground">
          Take a photo of the item or upload one from your device
        </p>
      </div>

      <div className="grid gap-6">
        <div className="space-y-4">
          <input
            type="file"
            accept="image/*"
            onChange={handleFileChange}
            className="hidden"
            id="photo-upload"
            disabled={isProcessing || isAnalyzing}
          />
          
          <Button
            onClick={() => document.getElementById('photo-upload')?.click()}
            disabled={isProcessing || isAnalyzing}
            className="w-full"
          >
            {isProcessing || isAnalyzing ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Upload className="w-4 h-4 mr-2" />
            )}
            {isProcessing ? 'Uploading...' : isAnalyzing ? 'Analyzing...' : 'Upload Photo'}
          </Button>

          <ImagePreview preview={preview} />
          <AIResults results={aiResults} />
        </div>

        <Button
          variant="outline"
          onClick={onSkip}
          disabled={isProcessing || isAnalyzing}
        >
          Skip for now
        </Button>
      </div>
    </div>
  );
};