import { Button } from "@/components/ui/button";
import { Loader2, Upload, Scan } from "lucide-react";
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
    handleSmartScan,
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
          
          <div className="space-y-4">
            <Button
              onClick={() => document.getElementById('photo-upload')?.click()}
              disabled={isProcessing || isAnalyzing}
              className="w-full"
            >
              {isProcessing ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Upload className="w-4 h-4 mr-2" />
              )}
              {isProcessing ? 'Uploading...' : 'Upload Photo'}
            </Button>

            {preview && (
              <div className="flex items-center justify-between p-3 bg-muted rounded-md">
                <div className="flex items-center space-x-3">
                  <img 
                    src={preview.url} 
                    alt="Preview" 
                    className="w-12 h-12 object-cover rounded"
                  />
                  <div className="text-sm">
                    <p className="font-medium truncate">{preview.name}</p>
                    <p className="text-muted-foreground">{preview.size}</p>
                  </div>
                </div>
                
                <Button
                  onClick={handleSmartScan}
                  disabled={isAnalyzing}
                  variant="secondary"
                  size="sm"
                >
                  {isAnalyzing ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Scan className="w-4 h-4 mr-2" />
                  )}
                  {isAnalyzing ? 'Scanning...' : 'Smart Scan'}
                </Button>
              </div>
            )}

            <AIResults results={aiResults} />
          </div>
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