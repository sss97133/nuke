
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { checkQueryError } from "@/utils/supabase-helpers";

interface FilePreview {
  url: string;
  name: string;
  size: string;
}

interface AIClassification {
  label: string;
  score: number;
}

export const usePhotoCapture = (onPhotoCapture: (file: File) => Promise<void>) => {
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
      await onPhotoCapture(file);
      
      toast({
        title: "Photo uploaded successfully",
        description: "You can now proceed with smart scan or continue with manual entry.",
      });
    } catch (error) {
      console.error("Error uploading photo:", error);
      toast({
        title: "Error uploading photo",
        description: "Please try again or skip this step.",
        variant: "destructive",
      });
    }
  };

  const handleSmartScan = async () => {
    if (!preview) return;

    setIsAnalyzing(true);
    try {
      const { data, error } = await supabase.functions.invoke('analyze-inventory-image', {
        body: { imageUrl: preview.url }
      });

      checkQueryError(error);

      setAiResults(data.classifications || []);
      
      toast({
        title: "Image analyzed successfully",
        description: "Review the suggested information in the next step.",
      });
    } catch (error) {
      console.error("Error analyzing image:", error);
      toast({
        title: "Error analyzing image",
        description: "Please try again or proceed with manual entry.",
        variant: "destructive",
      });
    } finally {
      setIsAnalyzing(false);
    }
  };

  return {
    preview,
    aiResults,
    isAnalyzing,
    handleFileChange,
    handleSmartScan,
  };
};
