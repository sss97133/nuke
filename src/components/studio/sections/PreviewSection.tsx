
import React from 'react';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { StudioWorkspace } from '../StudioWorkspace';
import type { WorkspaceDimensions, PTZTrack } from '../types/workspace';

interface PreviewSectionProps {
  dimensions: WorkspaceDimensions;
  ptzTracks: PTZTrack[];
  selectedCameraIndex: number | null;
  onCameraSelect: (index: number) => void;
}

export const PreviewSection: React.FC<PreviewSectionProps> = ({ 
  dimensions, 
  ptzTracks,
  selectedCameraIndex,
  onCameraSelect
}) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Studio Simulator</CardTitle>
        <CardDescription>
          Interactive 3D view of your studio setup. Click on cameras to select them for control.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <StudioWorkspace 
          dimensions={dimensions} 
          ptzTracks={ptzTracks}
          selectedCameraIndex={selectedCameraIndex}
          onCameraSelect={onCameraSelect}
        />
      </CardContent>
    </Card>
  );
};
