import React, { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Slider } from '@/components/ui/slider';
import { Plus, Minus } from 'lucide-react';

interface PTZTrack {
  x: number;
  y: number;
  z: number;
  length: number;
  speed: number;
  coneAngle: number;
}

interface FormData {
  length: number;
  width: number;
  height: number;
  ptzTracks: PTZTrack[];
}

interface StudioConfigFormProps {
  onUpdate: (data: FormData) => void;
  initialData?: {
    dimensions: {
      length: number;
      width: number;
      height: number;
    };
    ptzTracks: {
      position: {
        x: number;
        y: number;
        z: number;
      };
      length: number;
      speed: number;
      coneAngle: number;
    }[];
  };
}

export const StudioConfigForm = ({ onUpdate, initialData }: StudioConfigFormProps) => {
  const { register, handleSubmit, watch, setValue } = useForm<FormData>({
    defaultValues: {
      length: initialData?.dimensions.length || 30,
      width: initialData?.dimensions.width || 20,
      height: initialData?.dimensions.height || 16,
      ptzTracks: initialData?.ptzTracks.length ? initialData.ptzTracks.map(track => ({
        x: track.position.x,
        y: track.position.y,
        z: track.position.z,
        length: track.length,
        speed: track.speed,
        coneAngle: track.coneAngle,
      })) : [{
        x: 0,
        y: 8,
        z: 0,
        length: 10,
        speed: 1,
        coneAngle: 45,
      }],
    },
  });
  const { toast } = useToast();

  const formData = watch();

  useEffect(() => {
    if (onUpdate) {
      onUpdate(formData);
    }
  }, [formData, onUpdate]);

  const addTrack = () => {
    const currentTracks = watch('ptzTracks');
    setValue('ptzTracks', [...currentTracks, {
      x: 0,
      y: 8,
      z: 0,
      length: 10,
      speed: 1,
      coneAngle: 45,
    }]);
  };

  const removeTrack = (index: number) => {
    const currentTracks = watch('ptzTracks');
    setValue('ptzTracks', currentTracks.filter((_, i) => i !== index));
  };

  const onSubmit = async (data: FormData) => {
    try {
      const { error } = await supabase
        .from('studio_configurations')
        .insert({
          user_id: (await supabase.auth.getUser()).data.user?.id,
          name: 'Default Configuration',
          workspace_dimensions: {
            length: data.length,
            width: data.width,
            height: data.height
          },
          ptz_configurations: {
            tracks: data.ptzTracks.map(track => ({
              position: { x: track.x, y: track.y, z: track.z },
              length: track.length,
              speed: track.speed,
              coneAngle: track.coneAngle
            }))
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
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <Tabs defaultValue="dimensions" className="w-full">
        <TabsList>
          <TabsTrigger value="dimensions">Room Dimensions</TabsTrigger>
          <TabsTrigger value="ptz">PTZ Configuration</TabsTrigger>
        </TabsList>
        
        <TabsContent value="dimensions" className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label htmlFor="length">Length (ft)</Label>
              <Input
                id="length"
                type="number"
                {...register('length', { required: true, min: 0 })}
                placeholder="30"
              />
            </div>
            <div>
              <Label htmlFor="width">Width (ft)</Label>
              <Input
                id="width"
                type="number"
                {...register('width', { required: true, min: 0 })}
                placeholder="20"
              />
            </div>
            <div>
              <Label htmlFor="height">Height (ft)</Label>
              <Input
                id="height"
                type="number"
                {...register('height', { required: true, min: 0 })}
                placeholder="16"
              />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="ptz" className="space-y-4">
          <div className="flex justify-end">
            <Button 
              type="button" 
              onClick={addTrack}
              className="mb-4"
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Track
            </Button>
          </div>
          
          {formData.ptzTracks.map((track, index) => (
            <div key={index} className="border p-4 rounded-lg mb-4">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold">Track {index + 1}</h3>
                {index > 0 && (
                  <Button 
                    type="button" 
                    variant="destructive" 
                    onClick={() => removeTrack(index)}
                    size="sm"
                  >
                    <Minus className="w-4 h-4" />
                  </Button>
                )}
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Track X Position</Label>
                  <Input
                    type="number"
                    {...register(`ptzTracks.${index}.x`, { required: true })}
                    placeholder="0"
                  />
                </div>
                <div>
                  <Label>Track Y Position</Label>
                  <Input
                    type="number"
                    {...register(`ptzTracks.${index}.y`, { required: true })}
                    placeholder="8"
                  />
                </div>
                <div>
                  <Label>Track Z Position</Label>
                  <Input
                    type="number"
                    {...register(`ptzTracks.${index}.z`, { required: true })}
                    placeholder="0"
                  />
                </div>
                <div>
                  <Label>Track Length</Label>
                  <Input
                    type="number"
                    {...register(`ptzTracks.${index}.length`, { required: true, min: 1 })}
                    placeholder="10"
                  />
                </div>
                <div>
                  <Label>Camera Movement Speed</Label>
                  <Slider
                    min={0.1}
                    max={5}
                    step={0.1}
                    defaultValue={[track.speed]}
                    onValueChange={(value) => setValue(`ptzTracks.${index}.speed`, value[0])}
                  />
                </div>
                <div>
                  <Label>Camera Cone Angle (degrees)</Label>
                  <Slider
                    min={10}
                    max={120}
                    step={5}
                    defaultValue={[track.coneAngle]}
                    onValueChange={(value) => setValue(`ptzTracks.${index}.coneAngle`, value[0])}
                  />
                </div>
              </div>
            </div>
          ))}
        </TabsContent>
      </Tabs>
      
      <Button type="submit">Save Configuration</Button>
    </form>
  );
};