import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

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

    const previewUrl = URL.createObjectURL(file);
    setPreview({
      url: previewUrl,
      name: file.name,
      size: formatFileSize(file.size)
    });

    try {
      await onPhotoCapture(file);
      
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

  return {
    preview,
    aiResults,
    isAnalyzing,
    handleFileChange,
  };
};