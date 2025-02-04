import React from 'react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { StudioDimensions } from './form/StudioDimensions';
import { PTZConfiguration } from './form/PTZConfiguration';
import type { WorkspaceDimensions, PTZTrack } from '@/types/studio';

interface StudioConfigFormProps {
  onUpdate: (data: {
    length: number;
    width: number;
    height: number;
    ptzTracks: PTZTrack[];
  }) => void;
  initialData?: {
    dimensions: WorkspaceDimensions;
    ptzTracks: PTZTrack[];
  };
}

export const StudioConfigForm = ({ onUpdate, initialData }: StudioConfigFormProps) => {
  const [dimensions, setDimensions] = React.useState<WorkspaceDimensions>(
    initialData?.dimensions || { length: 30, width: 20, height: 16 }
  );
  const [ptzTracks, setPTZTracks] = React.useState<PTZTrack[]>(
    initialData?.ptzTracks || [{
      position: { x: 0, y: 8, z: 0 },
      length: 10,
      speed: 1,
      coneAngle: 45,
    }]
  );
  const { toast } = useToast();

  React.useEffect(() => {
    onUpdate({
      ...dimensions,
      ptzTracks,
    });
  }, [dimensions, ptzTracks, onUpdate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('No user found');

      const { error } = await supabase
        .from('studio_configurations')
        .insert({
          name: 'Default Configuration',
          workspace_dimensions: dimensions,
          ptz_configurations: {
            tracks: ptzTracks,
            planes: { walls: [], ceiling: {} },
            roboticArms: []
          }
        });

      if (error) throw error;

      toast({
        title: 'Success',
        description: 'Studio configuration updated successfully',
      });
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to update studio configuration',
        variant: 'destructive',
      });
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Tabs defaultValue="dimensions" className="w-full">
        <TabsList>
          <TabsTrigger value="dimensions">Room Dimensions</TabsTrigger>
          <TabsTrigger value="ptz">PTZ Configuration</TabsTrigger>
        </TabsList>
        
        <TabsContent value="dimensions" className="space-y-4">
          <StudioDimensions dimensions={dimensions} onUpdate={setDimensions} />
        </TabsContent>

        <TabsContent value="ptz" className="space-y-4">
          <PTZConfiguration ptzTracks={ptzTracks} onUpdate={setPTZTracks} />
        </TabsContent>
      </Tabs>
      
      <Button type="submit">Save Configuration</Button>
    </form>
  );
};