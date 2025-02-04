import { useState, useEffect } from 'react';
import { StudioWorkspaceV2 } from './StudioWorkspaceV2';
import { StudioConfigFormV2 } from './StudioConfigFormV2';
import { Card } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface TrackMovement {
  amplitude: { x: number; z: number };
  frequency: number;
  phase: number;
}

export interface StudioConfigV2 {
  dimensions: {
    length: number;
    width: number;
    height: number;
  };
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
  props: {
    toolBox: boolean;
    carLift: boolean;
    car: boolean;
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
    movement: TrackMovement;
  }[];
}

export const StudioConfigurationV2 = () => {
  const { toast } = useToast();
  const [config, setConfig] = useState<StudioConfigV2>({
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
  });

  useEffect(() => {
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

        if (error) {
          throw error;
        }

        if (data) {
          setConfig({
            dimensions: data.workspace_dimensions,
            humanPosition: { x: 0, y: 0, z: 0 },
            cameras: data.camera_config,
            props: data.camera_config.props || {
              toolBox: false,
              carLift: false,
              car: false
            },
            ptzTracks: data.ptz_configurations.tracks || []
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

    loadConfiguration();
  }, [toast]);

  const handleConfigUpdate = async (newConfig: StudioConfigV2) => {
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

  return (
    <div className="space-y-6 p-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="p-6">
          <h2 className="text-lg font-semibold mb-4">Studio Configuration v2</h2>
          <StudioConfigFormV2 
            onUpdate={handleConfigUpdate}
            initialConfig={config}
          />
        </Card>
        <Card className="p-6">
          <h2 className="text-lg font-semibold mb-4">Workspace Preview v2</h2>
          <StudioWorkspaceV2 
            config={config}
          />
        </Card>
      </div>
    </div>
  );
};