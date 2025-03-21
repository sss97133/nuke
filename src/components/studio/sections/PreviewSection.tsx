
import React from 'react';
import { StudioScene } from './preview/StudioScene';
import { LightingControls } from './preview/LightingControls';
import type { WorkspaceDimensions, PTZTrack } from '../types/workspace';

interface StudioPreviewProps {
  dimensions: WorkspaceDimensions;
  ptzTracks: PTZTrack[];
  selectedCameraIndex: number | null;
  onCameraSelect: (index: number) => void;
  lightMode: 'basic' | 'product' | 'visualization';
  setLightMode: (mode: 'basic' | 'product' | 'visualization') => void;
}

export const StudioPreview: React.FC<StudioPreviewProps> = ({ 
  dimensions, 
  ptzTracks, 
  selectedCameraIndex, 
  onCameraSelect,
  lightMode,
  setLightMode
}) => {
  // Handle zoom controls - these will be passed to StudioScene
  const handleZoomIn = () => {
    if ((window as any).zoomIn) {
      (window as any).zoomIn();
    }
  };

  const handleZoomOut = () => {
    if ((window as any).zoomOut) {
      (window as any).zoomOut();
    }
  };

  // Handle workspace layout toggle
  const handleToggleLayout = () => {
    console.log("Toggle workspace layout");
  };

  return (
    <div className="flex w-full h-full">
      <div className="w-3/4 h-full relative">
        <StudioScene
          dimensions={dimensions}
          ptzTracks={ptzTracks}
          selectedCameraIndex={selectedCameraIndex}
          onCameraSelect={onCameraSelect}
          lightMode={lightMode}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
        />
      </div>
      
      <div className="w-1/4 h-full pl-4">
        <LightingControls 
          lightMode={lightMode}
          onLightModeChange={setLightMode}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          onToggleLayout={handleToggleLayout}
        />
      </div>
    </div>
  );
};
