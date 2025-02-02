import { pipeline } from "@huggingface/transformers";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/components/ui/use-toast";

interface ImageProcessingProps {
  isProcessing: boolean;
  setIsProcessing: (value: boolean) => void;
}

export const ImageProcessing = ({ isProcessing, setIsProcessing }: ImageProcessingProps) => {
  const { toast } = useToast();

  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    try {
      const classifier = await pipeline(
        "image-classification",
        "onnx-community/mobilenetv4_conv_small.e2400_r224_in1k",
        { device: "webgpu" }
      );

      const imageUrl = URL.createObjectURL(file);
      const result = await classifier(imageUrl);
      
      const { data, error } = await supabase.storage
        .from("inventory-images")
        .upload(`${Date.now()}-${file.name}`, file);

      if (error) throw error;

      const detectedLabel = Array.isArray(result) && result.length > 0 
        ? (result[0] as { label?: string, score?: number }).label || 'Unknown'
        : 'Unknown';

      toast({
        title: "Image processed successfully",
        description: `Detected: ${detectedLabel}`,
      });
    } catch (error) {
      console.error("Error processing image:", error);
      toast({
        title: "Error processing image",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-gray-700">
        Upload Image
      </label>
      <input
        type="file"
        onChange={handleImageUpload}
        disabled={isProcessing}
        className="block w-full text-sm text-gray-500
          file:mr-4 file:py-2 file:px-4
          file:rounded-md file:border-0
          file:text-sm file:font-semibold
          file:bg-primary file:text-primary-foreground
          hover:file:bg-primary/90"
      />
    </div>
  );
};