import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';

interface WorkspaceCaptureProps {
  onCaptureComplete: (data: {
    pointCloud: Float32Array;
    dimensions: {
      length: number;
      width: number;
      height: number;
    };
    objects: Array<{
      type: string;
      position: { x: number; y: number; z: number };
      dimensions: { length: number; width: number; height: number };
    }>;
  }) => void;
}

export const WorkspaceCapture: React.FC<WorkspaceCaptureProps> = ({
  onCaptureComplete
}) => {
  const [isCapturing, setIsCapturing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const startCapture = async () => {
    try {
      setError(null);
      setIsCapturing(true);
      setProgress(0);

      // Request camera access
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          facingMode: 'environment'
        }
      });

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      streamRef.current = stream;

      // Start processing frames
      processFrames();
    } catch (err) {
      setError('Failed to access camera. Please ensure camera permissions are granted.');
      setIsCapturing(false);
    }
  };

  const stopCapture = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setIsCapturing(false);
    setProgress(0);
  };

  const processFrames = async () => {
    if (!videoRef.current || !isCapturing) return;

    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    // Draw current frame
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Convert frame to point cloud data
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const pointCloud = await processImageToPointCloud(imageData);

    // Update progress
    setProgress(prev => Math.min(prev + 10, 100));

    // Continue processing if still capturing
    if (isCapturing) {
      requestAnimationFrame(processFrames);
    }
  };

  const processImageToPointCloud = async (imageData: ImageData): Promise<Float32Array> => {
    // This is where we'll integrate with SpatialLM's point cloud processing
    // For now, return mock data
    return new Float32Array(1000 * 3); // 1000 points, each with x,y,z coordinates
  };

  useEffect(() => {
    return () => {
      stopCapture();
    };
  }, []);

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader>
        <CardTitle>Workspace Capture</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {error && (
            <div className="text-red-500 text-sm">{error}</div>
          )}
          
          <div className="relative aspect-video bg-black rounded-lg overflow-hidden">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              className="w-full h-full object-cover"
            />
            {!isCapturing && (
              <div className="absolute inset-0 flex items-center justify-center">
                <Button
                  onClick={startCapture}
                  variant="default"
                  size="lg"
                >
                  Start Capture
                </Button>
              </div>
            )}
          </div>

          {isCapturing && (
            <div className="space-y-2">
              <Progress value={progress} />
              <div className="text-sm text-gray-500">
                Processing workspace... {progress}%
              </div>
              <Button
                onClick={stopCapture}
                variant="destructive"
                className="w-full"
              >
                Stop Capture
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}; 