
import React from 'react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdate({
      ...dimensions,
      ptzTracks,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Tabs defaultValue="dimensions" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
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
      
      <div className="flex justify-end">
        <Button type="submit">Save Configuration</Button>
      </div>
    </form>
  );
};

