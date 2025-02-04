import React from 'react';
import { Card } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';

interface PreviewSectionProps {
  selectedCamera: number | null;
  setSelectedCamera: (id: number) => void;
}

export const PreviewSection = ({ selectedCamera, setSelectedCamera }: PreviewSectionProps) => {
  const { toast } = useToast();

  return (
    <div className="grid grid-cols-2 gap-4">
      {[1, 2, 3, 4].map((cameraId) => (
        <Card 
          key={cameraId}
          className={`p-4 cursor-pointer transition-all ${
            selectedCamera === cameraId ? 'ring-2 ring-primary' : ''
          }`}
          onClick={() => {
            setSelectedCamera(cameraId);
            toast({
              title: "Camera Selected",
              description: `Switched to camera ${cameraId}`,
            });
          }}
        >
          <div className="aspect-video bg-muted flex items-center justify-center">
            <p className="text-muted-foreground">Camera {cameraId} Feed</p>
          </div>
          <div className="mt-2 flex justify-between items-center">
            <span className="text-sm font-medium">PTZ Camera {cameraId}</span>
            <span className="text-xs text-muted-foreground">
              {selectedCamera === cameraId ? 'Selected' : 'Click to select'}
            </span>
          </div>
        </Card>
      ))}
    </div>
  );
};