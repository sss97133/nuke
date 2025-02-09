
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { StudioConfigForm } from './StudioConfigForm';
import { useStudioConfig } from '@/hooks/useStudioConfig';
import { Card } from '@/components/ui/card';
import { PTZConfiguration } from './form/PTZConfiguration';
import { StudioDimensions } from './form/StudioDimensions';
import { StudioWorkspace } from './StudioWorkspace';
import type { WorkspaceDimensions, PTZTrack } from '@/types/studio';
import { toJson } from '@/types/json';

export const StudioConfiguration = () => {
  const { toast } = useToast();
  const defaultDimensions: WorkspaceDimensions = {
    length: 30,
    width: 20,
    height: 16
  };

  const { data: studioConfig, isLoading, error } = useStudioConfig(defaultDimensions);
  const [dimensions, setDimensions] = React.useState<WorkspaceDimensions>(defaultDimensions);
  const [ptzTracks, setPTZTracks] = React.useState<PTZTrack[]>([{
    position: { x: 0, y: 8, z: 0 },
    length: 10,
    speed: 1,
    coneAngle: 45,
  }]);

  React.useEffect(() => {
    if (studioConfig) {
      setDimensions(studioConfig.workspace_dimensions);
      setPTZTracks(studioConfig.ptz_configurations.tracks);
    }
  }, [studioConfig]);

  const handleUpdate = async (data: {
    length: number;
    width: number;
    height: number;
    ptzTracks: PTZTrack[];
  }) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('No user found');

      const { error } = await supabase
        .from('studio_configurations')
        .upsert({
          user_id: user.id,
          name: 'Default Configuration',
          workspace_dimensions: toJson({
            length: data.length,
            width: data.width,
            height: data.height
          }),
          ptz_configurations: toJson({
            tracks: data.ptzTracks,
            planes: { walls: [], ceiling: {} },
            roboticArms: []
          })
        });

      if (error) throw error;

      toast({
        title: 'Success',
        description: 'Studio configuration updated successfully',
      });
    } catch (error) {
      console.error('Error:', error);
      toast({
        title: 'Error',
        description: 'Failed to update studio configuration',
        variant: 'destructive',
      });
    }
  };

  if (isLoading) {
    return <div>Loading...</div>;
  }

  if (error) {
    return <div>Error loading studio configuration</div>;
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="p-6">
          <h2 className="text-2xl font-bold mb-6">Studio Configuration</h2>
          <StudioConfigForm
            onUpdate={handleUpdate}
            initialData={{
              dimensions,
              ptzTracks
            }}
          />
        </Card>
        
        <Card className="p-6">
          <h2 className="text-2xl font-bold mb-6">Workspace Preview</h2>
          <div className="aspect-video w-full border rounded-lg overflow-hidden">
            <StudioWorkspace 
              dimensions={dimensions}
              ptzTracks={ptzTracks}
            />
          </div>
        </Card>
      </div>
    </div>
  );
};

