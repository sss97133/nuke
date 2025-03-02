
import React from 'react';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { StudioConfigForm } from '../StudioConfigForm';
import type { WorkspaceDimensions, PTZTrack } from '../types/workspace';

interface SettingsSectionProps {
  dimensions: WorkspaceDimensions;
  ptzTracks: PTZTrack[];
  onUpdate: (data: {
    length: number;
    width: number;
    height: number;
    ptzTracks: PTZTrack[];
  }) => void;
}

export const SettingsSection: React.FC<SettingsSectionProps> = ({ 
  dimensions, 
  ptzTracks, 
  onUpdate 
}) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Studio Configuration</CardTitle>
        <CardDescription>Configure your studio dimensions and camera setup</CardDescription>
      </CardHeader>
      <CardContent>
        <StudioConfigForm 
          initialData={{ dimensions, ptzTracks }}
          onUpdate={onUpdate}
        />
      </CardContent>
    </Card>
  );
};
