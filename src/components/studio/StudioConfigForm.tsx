import React, { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface FormData {
  length: number;
  width: number;
  height: number;
  ptzTracks: {
    x: number;
    y: number;
    z: number;
    length: number;
  }[];
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
    }[];
  };
}

export const StudioConfigForm = ({ onUpdate, initialData }: StudioConfigFormProps) => {
  const { register, handleSubmit, watch } = useForm<FormData>({
    defaultValues: {
      length: initialData?.dimensions.length || 30,
      width: initialData?.dimensions.width || 20,
      height: initialData?.dimensions.height || 16,
      ptzTracks: [{
        x: initialData?.ptzTracks[0]?.position.x || 0,
        y: initialData?.ptzTracks[0]?.position.y || 8,
        z: initialData?.ptzTracks[0]?.position.z || 0,
        length: initialData?.ptzTracks[0]?.length || 10,
      }],
    },
  });
  const { toast } = useToast();

  // Watch all form fields for changes
  const formData = watch();

  // Update preview whenever form values change
  useEffect(() => {
    if (onUpdate) {
      onUpdate(formData);
    }
  }, [formData, onUpdate]);

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
              length: track.length
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
          <div className="grid grid-cols-4 gap-4">
            <div>
              <Label htmlFor="ptz-x">Track X Position</Label>
              <Input
                id="ptz-x"
                type="number"
                {...register('ptzTracks.0.x', { required: true })}
                placeholder="0"
              />
            </div>
            <div>
              <Label htmlFor="ptz-y">Track Y Position</Label>
              <Input
                id="ptz-y"
                type="number"
                {...register('ptzTracks.0.y', { required: true })}
                placeholder="0"
              />
            </div>
            <div>
              <Label htmlFor="ptz-z">Track Z Position</Label>
              <Input
                id="ptz-z"
                type="number"
                {...register('ptzTracks.0.z', { required: true })}
                placeholder="0"
              />
            </div>
            <div>
              <Label htmlFor="ptz-length">Track Length</Label>
              <Input
                id="ptz-length"
                type="number"
                {...register('ptzTracks.0.length', { required: true, min: 1 })}
                placeholder="10"
              />
            </div>
          </div>
        </TabsContent>
      </Tabs>
      
      <Button type="submit">Save Configuration</Button>
    </form>
  );
};