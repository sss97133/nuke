
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

  return (
    <div className="relative h-full">
      <StudioScene
        dimensions={dimensions}
        ptzTracks={ptzTracks}
        selectedCameraIndex={selectedCameraIndex}
        onCameraSelect={onCameraSelect}
        lightMode={lightMode}
      />
      <div className="absolute bottom-4 right-4">
        <LightingControls 
          lightMode={lightMode}
          onLightModeChange={handleLightModeChange}
        />
      </div>
    </div>
  );
};
