
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { checkQueryError } from "@/utils/supabase-helpers";

interface VinCaptureProps {
  onVinCaptured: (data: any) => void;
}

export const useVinCapture = ({ onVinCaptured }: VinCaptureProps) => {
  const { toast } = useToast();
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [recognizedVin, setRecognizedVin] = useState<string | null>(null);

  const handleImageChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Check file size
    if (file.size > 10 * 1024 * 1024) { // 10MB limit
      toast({
        title: "File too large",
        description: "The image must be less than 10MB.",
        variant: "destructive",
      });
      return;
    }

    // Preview the image
    const reader = new FileReader();
    reader.onload = (e) => {
      setImagePreview(e.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  const processVin = async () => {
    if (!imagePreview) return;

    setIsProcessing(true);
    try {
      const { data, error } = await supabase.functions.invoke('process-vin', {
        body: { image: imagePreview }
      });

      checkQueryError(error);
      
      if (data?.vin) {
        setRecognizedVin(data.vin);
        onVinCaptured(data);
        
        toast({
          title: "VIN Detected",
          description: `Successfully detected VIN: ${data.vin}`,
        });
      } else {
        toast({
          title: "VIN Detection Failed",
          description: "Could not detect a valid VIN in the image. Try a clearer photo.",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error('Error processing VIN:', error);
      toast({
        title: "Error",
        description: "Failed to process VIN image. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const reset = () => {
    setImagePreview(null);
    setRecognizedVin(null);
  };

  return {
    imagePreview,
    isLoading,
    isProcessing,
    recognizedVin,
    handleImageChange,
    processVin,
    reset,
  };
};
