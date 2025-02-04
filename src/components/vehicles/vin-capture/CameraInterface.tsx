import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Camera } from "lucide-react";

interface CameraInterfaceProps {
  onCapture: () => void;
  isProcessing: boolean;
  videoRef: React.RefObject<HTMLVideoElement>;
}

export const CameraInterface = ({ onCapture, isProcessing, videoRef }: CameraInterfaceProps) => {
  return (
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
        onClick={onCapture}
        disabled={isProcessing}
        className="absolute bottom-4 left-1/2 transform -translate-x-1/2 font-mono text-sm"
      >
        Capture
      </Button>
    </div>
  );
};