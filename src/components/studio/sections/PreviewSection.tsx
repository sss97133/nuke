
import React, { useState } from 'react';
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
  const handleLightModeChange = (mode: 'basic' | 'product' | 'visualization') => {
    setLightMode(mode);
  };

  // Handle zoom controls
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
    // Implementation would go here
    console.log("Toggle workspace layout");
  };

  return (
    <div className="relative h-full">
      <StudioScene
        dimensions={dimensions}
        ptzTracks={ptzTracks}
        selectedCameraIndex={selectedCameraIndex}
        onCameraSelect={onCameraSelect}
        lightMode={lightMode}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
      />
      <div className="absolute top-1/2 right-4 transform -translate-y-1/2">
        <LightingControls 
          lightMode={lightMode}
          onLightModeChange={handleLightModeChange}
        />
      </div>
    </div>
  );
};
