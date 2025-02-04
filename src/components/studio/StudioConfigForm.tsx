import React, { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { DimensionsSection } from './config/DimensionsSection';
import { CameraConfigSection } from './config/CameraConfigSection';
import { PTZConfigSection } from './config/PTZConfigSection';
import { HumanPositionSection } from './config/HumanPositionSection';

interface FormData {
  length: number;
  width: number;
  height: number;
  humanPosition: {
    x: number;
    y: number;
    z: number;
  };
  cameras: {
    frontWall: boolean;
    backWall: boolean;
    leftWall: boolean;
    rightWall: boolean;
    ceiling: boolean;
    showCone: boolean;
  };
  ptzTracks: {
    x: number;
    y: number;
    z: number;
    length: number;
    speed: number;
    coneAngle: number;
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
    humanPosition?: {
      x: number;
      y: number;
      z: number;
    };
    cameras?: {
      frontWall: boolean;
      backWall: boolean;
      leftWall: boolean;
      rightWall: boolean;
      ceiling: boolean;
      showCone: boolean;
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
      humanPosition: initialData?.humanPosition || { x: 0, y: 0, z: 0 },
      cameras: initialData?.cameras || {
        frontWall: false,
        backWall: false,
        leftWall: false,
        rightWall: false,
        ceiling: false,
        showCone: true,
      },
      ptzTracks: [{
        x: initialData?.ptzTracks[0]?.position.x || 0,
        y: initialData?.ptzTracks[0]?.position.y || 8,
        z: initialData?.ptzTracks[0]?.position.z || 0,
        length: initialData?.ptzTracks[0]?.length || 10,
        speed: initialData?.ptzTracks[0]?.speed || 1,
        coneAngle: initialData?.ptzTracks[0]?.coneAngle || 45,
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

  const handleCameraChange = (key: string, value: boolean) => {
    setValue(`cameras.${key}` as any, value);
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <Tabs defaultValue="dimensions" className="w-full">
        <TabsList>
          <TabsTrigger value="dimensions">Room Dimensions</TabsTrigger>
          <TabsTrigger value="cameras">Cameras</TabsTrigger>
          <TabsTrigger value="ptz">PTZ Configuration</TabsTrigger>
          <TabsTrigger value="human">Human Position</TabsTrigger>
        </TabsList>
        
        <TabsContent value="dimensions">
          <DimensionsSection register={register} />
        </TabsContent>

        <TabsContent value="cameras">
          <CameraConfigSection 
            cameras={formData.cameras}
            onCameraChange={handleCameraChange}
          />
        </TabsContent>

        <TabsContent value="ptz">
          <PTZConfigSection
            register={register}
            ptzTrack={formData.ptzTracks[0]}
            onSpeedChange={(value) => setValue('ptzTracks.0.speed', value[0])}
            onConeAngleChange={(value) => setValue('ptzTracks.0.coneAngle', value[0])}
          />
        </TabsContent>

        <TabsContent value="human">
          <HumanPositionSection register={register} />
        </TabsContent>
      </Tabs>
      
      <Button type="submit">Save Configuration</Button>
    </form>
  );
};