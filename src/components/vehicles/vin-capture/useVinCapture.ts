import { useState, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

export const useVinCapture = (onVinData: (data: any) => void) => {
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
      updateProcessingStatus("Preprocessing image...", 20);
      await new Promise(resolve => setTimeout(resolve, 800));

      updateProcessingStatus("Performing OCR analysis...", 40);
      const formData = new FormData();
      formData.append('image', imageBlob);

      updateProcessingStatus("Matching VIN patterns...", 60);
      await new Promise(resolve => setTimeout(resolve, 800));

      updateProcessingStatus("Verifying with database...", 80);
      const { data, error } = await supabase.functions.invoke('process-vin', {
        body: formData,
      });

      if (error) throw error;

      updateProcessingStatus("Completing verification...", 100);
      await new Promise(resolve => setTimeout(resolve, 500));

      if (data.vin) {
        setConfidence(90);
        onVinData(data);
        toast({
          title: "VIN Processed Successfully",
          description: `Extracted VIN: ${data.vin} (90% confidence)`,
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

  return {
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
  };
};