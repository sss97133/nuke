import { useState } from 'react';
import { StudioWorkspaceV2 } from './StudioWorkspaceV2';
import { StudioConfigFormV2 } from './StudioConfigFormV2';
import { Card } from '@/components/ui/card';

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

  const handleConfigUpdate = (newConfig: StudioConfigV2) => {
    setConfig(newConfig);
    console.log('Updated studio configuration:', newConfig);
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