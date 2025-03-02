
import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PlayCircle, PauseCircle, Share, Users } from 'lucide-react';
import { StudioPreview } from '@/components/studio/sections/PreviewSection';
import { StreamingControls } from '@/components/studio/controls/StreamingControls';
import type { WorkspaceDimensions, PTZTrack } from '@/components/studio/types/workspace';

interface StreamTabProps {
  dimensions: WorkspaceDimensions;
  ptzTracks: PTZTrack[];
  selectedCameraIndex: number | null;
  onCameraSelect: (index: number) => void;
  lightMode: 'basic' | 'product';
  setLightMode: (mode: 'basic' | 'product') => void;
  isLive: boolean;
  toggleLive: () => void;
}

export const StreamTab: React.FC<StreamTabProps> = ({
  dimensions,
  ptzTracks,
  selectedCameraIndex,
  onCameraSelect,
  lightMode,
  setLightMode,
  isLive,
  toggleLive
}) => {
  return (
    <div className="grid gap-6 md:grid-cols-3">
      <div className="md:col-span-2">
        <Card className="border-2 border overflow-hidden p-0">
          <StudioPreview 
            dimensions={dimensions}
            ptzTracks={ptzTracks}
            selectedCameraIndex={selectedCameraIndex}
            onCameraSelect={onCameraSelect}
            lightMode={lightMode}
            setLightMode={setLightMode}
          />
        </Card>
        
        <div className="flex justify-center space-x-4 mt-4">
          <Button
            variant={isLive ? "destructive" : "default"}
            size="lg"
            className="gap-2"
            onClick={toggleLive}
          >
            {isLive ? (
              <>
                <PauseCircle className="h-5 w-5" />
                End Stream
              </>
            ) : (
              <>
                <PlayCircle className="h-5 w-5" />
                Go Live
              </>
            )}
          </Button>
          
          <Button variant="outline" size="lg" className="gap-2">
            <Share className="h-5 w-5" />
            Share Stream
          </Button>
        </div>
      </div>
      
      <div className="space-y-6">
        <StreamingControls 
          onStart={() => toggleLive()}
          onStop={() => toggleLive()}
        />
        
        <Card>
          <CardHeader>
            <CardTitle>Viewer Stats</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-center py-4">
              <Users className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
              <p className="text-3xl font-bold">0</p>
              <p className="text-sm text-muted-foreground">Live Viewers</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
