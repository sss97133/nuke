import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { StudioConfigV2 } from '../types/studioConfig';
import { useToast } from '@/hooks/use-toast';

const defaultConfig: StudioConfigV2 = {
  dimensions: {
    length: 30,
    width: 20,
    height: 16,
  },
  humanPosition: {
    x: 0,
    y: 0,
    z: 0,
  },
  cameras: {
    frontWall: false,
    backWall: false,
    leftWall: false,
    rightWall: false,
    ceiling: false,
    showCone: true,
  },
  props: {
    toolBox: false,
    carLift: false,
    car: false,
  },
  ptzTracks: [{
    position: {
      x: 0,
      y: 8,
      z: 0,
    },
    length: 10,
    speed: 1,
    coneAngle: 45,
    movement: {
      amplitude: { x: 2, z: 2 },
      frequency: 0.5,
      phase: 0
    }
  }]
};

export const useStudioConfig = () => {
  const { toast } = useToast();
  const [config, setConfig] = useState<StudioConfigV2>(defaultConfig);

  useEffect(() => {
    loadConfiguration();
  }, []);

  const loadConfiguration = async () => {
    try {
      const { data: session } = await supabase.auth.getSession();
      if (!session?.session?.user) {
        toast({
          title: "Authentication required",
          description: "Please log in to access studio configurations",
          variant: "destructive"
        });
        return;
      }

      const { data, error } = await supabase
        .from('studio_configurations')
        .select('*')
        .eq('user_id', session.session.user.id)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        const workspaceDimensions = data.workspace_dimensions as StudioConfigV2['dimensions'];
        const cameraConfig = data.camera_config as StudioConfigV2['cameras'];
        const ptzConfig = data.ptz_configurations as { tracks: StudioConfigV2['ptzTracks'] };

        setConfig({
          dimensions: workspaceDimensions,
          humanPosition: { x: 0, y: 0, z: 0 },
          cameras: cameraConfig,
          props: cameraConfig.props || defaultConfig.props,
          ptzTracks: ptzConfig?.tracks || defaultConfig.ptzTracks
        });
      }
    } catch (error) {
      console.error('Error loading configuration:', error);
      toast({
        title: "Error",
        description: "Failed to load studio configuration",
        variant: "destructive"
      });
    }
  };

  const saveConfiguration = async (newConfig: StudioConfigV2) => {
    try {
      const { data: session } = await supabase.auth.getSession();
      if (!session?.session?.user) {
        toast({
          title: "Authentication required",
          description: "Please log in to save configurations",
          variant: "destructive"
        });
        return;
      }

      const { error } = await supabase
        .from('studio_configurations')
        .upsert({
          user_id: session.session.user.id,
          name: 'Default Configuration',
          workspace_dimensions: newConfig.dimensions,
          camera_config: {
            ...newConfig.cameras,
            props: newConfig.props
          },
          ptz_configurations: {
            tracks: newConfig.ptzTracks
          }
        });

      if (error) throw error;

      setConfig(newConfig);
      toast({
        title: "Success",
        description: "Studio configuration saved successfully",
      });
    } catch (error) {
      console.error('Error saving configuration:', error);
      toast({
        title: "Error",
        description: "Failed to save studio configuration",
        variant: "destructive"
      });
    }
  };

  return {
    config,
    saveConfiguration
  };
};