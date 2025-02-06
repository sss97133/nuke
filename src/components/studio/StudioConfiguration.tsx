import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Camera, Mic, Lightbulb, Save, Plus } from 'lucide-react';
import { StudioWorkspace } from './StudioWorkspace';

export const StudioConfiguration = () => {
  const { toast } = useToast();
  const [dimensions, setDimensions] = useState({
    length: 30,
    width: 20,
    height: 16
  });

  const [ptzTracks, setPtzTracks] = useState([{
    position: { x: 0, y: 8, z: 0 },
    length: 10,
    speed: 1,
    coneAngle: 45
  }]);

  const { data: config, isLoading } = useQuery({
    queryKey: ['studio-config'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('studio_configurations')
        .select('*')
        .single();

      if (error) {
        console.error('Error fetching studio config:', error);
        toast({
          title: 'Error loading configuration',
          description: error.message,
          variant: 'destructive',
        });
        throw error;
      }

      return data;
    },
  });

  const handleSave = async () => {
    try {
      const { error } = await supabase
        .from('studio_configurations')
        .upsert({
          workspace_dimensions: dimensions,
          ptz_configurations: {
            tracks: ptzTracks
          }
        });

      if (error) throw error;

      toast({
        title: 'Configuration Saved',
        description: 'Your studio settings have been updated.',
      });
    } catch (error) {
      console.error('Error saving config:', error);
      toast({
        title: 'Error',
        description: 'Failed to save configuration',
        variant: 'destructive',
      });
    }
  };

  const addPTZTrack = () => {
    setPtzTracks([...ptzTracks, {
      position: { x: 0, y: 8, z: 0 },
      length: 10,
      speed: 1,
      coneAngle: 45
    }]);
  };

  if (isLoading) {
    return <div>Loading configuration...</div>;
  }

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <h2 className="text-2xl font-bold mb-4">Studio Configuration</h2>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-4">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <Camera className="w-5 h-5" />
              Workspace Dimensions
            </h3>
            
            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label>Length (ft)</Label>
                <Input
                  type="number"
                  value={dimensions.length}
                  onChange={(e) => setDimensions({
                    ...dimensions,
                    length: Number(e.target.value)
                  })}
                />
              </div>
              <div>
                <Label>Width (ft)</Label>
                <Input
                  type="number"
                  value={dimensions.width}
                  onChange={(e) => setDimensions({
                    ...dimensions,
                    width: Number(e.target.value)
                  })}
                />
              </div>
              <div>
                <Label>Height (ft)</Label>
                <Input
                  type="number"
                  value={dimensions.height}
                  onChange={(e) => setDimensions({
                    ...dimensions,
                    height: Number(e.target.value)
                  })}
                />
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <Camera className="w-5 h-5" />
                PTZ Camera Tracks
              </h3>
              <Button
                variant="outline"
                size="sm"
                onClick={addPTZTrack}
                className="flex items-center gap-2"
              >
                <Plus className="w-4 h-4" />
                Add Track
              </Button>
            </div>

            {ptzTracks.map((track, index) => (
              <div key={index} className="space-y-2 border p-4 rounded-lg">
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <Label>Length (ft)</Label>
                    <Input
                      type="number"
                      value={track.length}
                      onChange={(e) => {
                        const newTracks = [...ptzTracks];
                        newTracks[index].length = Number(e.target.value);
                        setPtzTracks(newTracks);
                      }}
                    />
                  </div>
                  <div>
                    <Label>Speed</Label>
                    <Input
                      type="number"
                      value={track.speed}
                      onChange={(e) => {
                        const newTracks = [...ptzTracks];
                        newTracks[index].speed = Number(e.target.value);
                        setPtzTracks(newTracks);
                      }}
                    />
                  </div>
                  <div>
                    <Label>Cone Angle (°)</Label>
                    <Input
                      type="number"
                      value={track.coneAngle}
                      onChange={(e) => {
                        const newTracks = [...ptzTracks];
                        newTracks[index].coneAngle = Number(e.target.value);
                        setPtzTracks(newTracks);
                      }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-6 flex justify-end">
          <Button onClick={handleSave} className="flex items-center gap-2">
            <Save className="w-4 h-4" />
            Save Configuration
          </Button>
        </div>
      </Card>

      <div className="w-full h-[600px] border border-border rounded-lg shadow-classic">
        <StudioWorkspace 
          dimensions={dimensions}
          ptzTracks={ptzTracks}
        />
      </div>
    </div>
  );
};