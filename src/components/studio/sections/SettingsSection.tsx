import React from 'react';
import { Card } from '@/components/ui/card';
import { StudioConfigForm } from '../StudioConfigForm';
import { StudioWorkspace } from '../StudioWorkspace';
import type { WorkspaceDimensions, PTZTrack } from '@/types/studio';

interface SettingsSectionProps {
  dimensions: WorkspaceDimensions;
  setDimensions: (dimensions: WorkspaceDimensions) => void;
  ptzTracks: PTZTrack[];
}

export const SettingsSection = ({ dimensions, setDimensions, ptzTracks }: SettingsSectionProps) => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <Card className="p-6">
        <h2 className="text-lg font-semibold mb-4">Studio Configuration</h2>
        <StudioConfigForm 
          onUpdate={(data) => {
            setDimensions({
              length: Number(data.length),
              width: Number(data.width),
              height: Number(data.height),
            });
          }}
          initialData={{ dimensions, ptzTracks }}
        />
      </Card>
      <Card className="p-6">
        <h2 className="text-lg font-semibold mb-4">Workspace Preview</h2>
        <StudioWorkspace 
          dimensions={dimensions} 
          ptzTracks={ptzTracks}
        />
      </Card>
    </div>
  );
};