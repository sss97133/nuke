
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { StudioConfigForm } from './StudioConfigForm';
import type { WorkspaceDimensions, PTZTrack } from '@/types/studio';
import { toJson } from '@/types/json';

export const StudioConfiguration = () => {
  const { toast } = useToast();
  const [dimensions, setDimensions] = React.useState<WorkspaceDimensions>({
    length: 30,
    width: 20,
    height: 16
  });
  const [ptzTracks, setPTZTracks] = React.useState<PTZTrack[]>([]);

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

      if (error) {
        console.error('Error updating studio configuration:', error);
        throw error;
      }

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

  return (
    <div className="space-y-6">
      <StudioConfigForm
        onUpdate={handleUpdate}
        initialData={{
          dimensions,
          ptzTracks
        }}
      />
    </div>
  );
};
