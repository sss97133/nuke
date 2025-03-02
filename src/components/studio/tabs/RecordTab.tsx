
import React from 'react';
import { Card } from "@/components/ui/card";
import { StudioPreview } from '@/components/studio/sections/PreviewSection';
import { RecordingControls } from '@/components/studio/controls/RecordingControls';
import { CameraControls } from '@/components/studio/controls/CameraControls';
import { AudioControls } from '@/components/studio/controls/AudioControls';
import { ControlButtons } from '@/components/studio/sections/ControlButtons';
import type { WorkspaceDimensions, PTZTrack } from '@/components/studio/types/workspace';

interface RecordTabProps {
  dimensions: WorkspaceDimensions;
  ptzTracks: PTZTrack[];
  selectedCameraIndex: number | null;
  onCameraSelect: (index: number) => void;
  lightMode: 'basic' | 'product';
  setLightMode: (mode: 'basic' | 'product') => void;
  isRecording: boolean;
  toggleRecording: () => void;
}

export const RecordTab: React.FC<RecordTabProps> = ({
  dimensions,
  ptzTracks,
  selectedCameraIndex,
  onCameraSelect,
  lightMode,
  setLightMode,
  isRecording,
  toggleRecording
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
        
        <ControlButtons 
          isRecording={isRecording}
          toggleRecording={toggleRecording}
        />
      </div>
      
      <div className="space-y-6">
        <CameraControls />
        
        <AudioControls 
          audioLevel={75}
          setAudioLevel={() => {}}
        />
        
        <RecordingControls 
          onStart={() => toggleRecording()}
          onStop={() => toggleRecording()}
        />
      </div>
    </div>
  );
};
