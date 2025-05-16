
import React from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { SettingsSection } from '@/components/studio/sections/SettingsSection';
import { PTZControls } from '@/components/studio/controls/PTZControls';
import type { WorkspaceDimensions, PTZTrack } from '@/components/studio/types/workspace';

interface SettingsTabProps {
  dimensions: WorkspaceDimensions;
  ptzTracks: PTZTrack[];
  selectedCameraIndex: number | null;
  onUpdate: (data: {
    length: number;
    width: number;
    height: number;
    ptzTracks: PTZTrack[];
  }) => void;
}

export const SettingsTab: React.FC<SettingsTabProps> = ({
  dimensions,
  ptzTracks,
  selectedCameraIndex,
  onUpdate
}) => {
  return (
    <>
      <SettingsSection 
        dimensions={dimensions}
        ptzTracks={ptzTracks}
        onUpdate={onUpdate}
      />
      
      {selectedCameraIndex !== null && (
        <div className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Camera Settings</CardTitle>
              <CardDescription>Configure the selected camera</CardDescription>
            </CardHeader>
            <CardContent>
              <PTZControls
                selectedCamera={ptzTracks[selectedCameraIndex]}
                onUpdate={(updatedCamera) => {
                  const newTracks = [...ptzTracks];
                  newTracks[selectedCameraIndex] = updatedCamera;
                  onUpdate({
                    length: dimensions.length,
                    width: dimensions.width,
                    height: dimensions.height,
                    ptzTracks: newTracks
                  });
                }}
              />
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
};
