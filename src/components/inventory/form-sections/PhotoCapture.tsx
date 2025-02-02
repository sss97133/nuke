import { useState } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Upload, Check, X } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface PhotoCaptureProps {
  onPhotoCapture: (file: File) => Promise<void>;
  onSkip: () => void;
  isProcessing: boolean;
}

interface FilePreview {
  url: string;
  name: string;
  size: string;
}

interface AIClassification {
  label: string;
  score: number;
}

export const PhotoCapture = ({ onPhotoCapture, onSkip, isProcessing }: PhotoCaptureProps) => {
  const { toast } = useToast();
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [aiResults, setAiResults] = useState<AIClassification[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Create preview
    const previewUrl = URL.createObjectURL(file);
    setPreview({
      url: previewUrl,
      name: file.name,
      size: formatFileSize(file.size)
    });

    try {
      // Upload file
      await onPhotoCapture(file);
      
      // Start AI analysis
      setIsAnalyzing(true);
      const formData = new FormData();
      formData.append('image', file);

      const { data, error } = await supabase.functions.invoke('analyze-inventory-image', {
        body: formData,
      });

      if (error) throw error;

      setAiResults(data.classifications);
      
      toast({
        title: "Image analyzed successfully",
        description: "Please review the detected items below.",
      });
    } catch (error) {
      console.error('Error processing image:', error);
      toast({
        title: "Error processing image",
        description: "Please try again or skip this step.",
        variant: "destructive",
      });
    } finally {
      setIsAnalyzing(false);
    }
  };

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

          {preview && (
            <div className="p-4 border rounded-lg space-y-4">
              <div className="aspect-square w-48 mx-auto relative">
                <img
                  src={preview.url}
                  alt="Preview"
                  className="w-full h-full object-cover rounded-md"
                />
              </div>
              <div className="text-sm space-y-1">
                <p className="font-medium">{preview.name}</p>
                <p className="text-muted-foreground">{preview.size}</p>
              </div>
            </div>
          )}

          {aiResults.length > 0 && (
            <Alert>
              <AlertTitle>AI Detection Results</AlertTitle>
              <AlertDescription>
                <div className="mt-2 space-y-2">
                  {aiResults.map((result, index) => (
                    <div key={index} className="flex items-center justify-between">
                      <span>{result.label}</span>
                      <span className="text-sm text-muted-foreground">
                        {(result.score * 100).toFixed(1)}%
                      </span>
                    </div>
                  ))}
                </div>
              </AlertDescription>
            </Alert>
          )}
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