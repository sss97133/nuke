import { useState } from 'react';
import { StudioWorkspace } from './StudioWorkspace';
import { StudioConfigForm } from './StudioConfigForm';
import { Card } from '@/components/ui/card';

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
  props: {
    toolBox: boolean;
    carLift: boolean;
    car: boolean;
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

export const StudioConfiguration = () => {
  const [dimensions, setDimensions] = useState({
    length: 30,
    width: 20,
    height: 16,
  });

  const [humanPosition, setHumanPosition] = useState({
    x: 0,
    y: 0,
    z: 0,
  });

  const [cameras, setCameras] = useState({
    frontWall: false,
    backWall: false,
    leftWall: false,
    rightWall: false,
    ceiling: false,
    showCone: true,
  });

  const [props, setProps] = useState({
    toolBox: false,
    carLift: false,
    car: false,
  });

  const [ptzTracks, setPtzTracks] = useState([
    {
      position: { x: 0, y: 8, z: 0 },
      length: 10,
      speed: 1,
      coneAngle: 45
    }
  ]);

  const handleConfigUpdate = (data: FormData) => {
    setDimensions({
      length: Number(data.length) || 30,
      width: Number(data.width) || 20,
      height: Number(data.height) || 16,
    });

    setHumanPosition({
      x: Number(data.humanPosition.x) || 0,
      y: Number(data.humanPosition.y) || 0,
      z: Number(data.humanPosition.z) || 0,
    });

    setCameras(data.cameras);
    setProps(data.props);

    if (data.ptzTracks?.[0]) {
      setPtzTracks([
        {
          position: {
            x: Number(data.ptzTracks[0].x) || 0,
            y: Number(data.ptzTracks[0].y) || 8,
            z: Number(data.ptzTracks[0].z) || 0,
          },
          length: Number(data.ptzTracks[0].length) || 10,
          speed: Number(data.ptzTracks[0].speed) || 1,
          coneAngle: Number(data.ptzTracks[0].coneAngle) || 45,
        },
      ]);
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="p-6">
          <h2 className="text-lg font-semibold mb-4">Studio Configuration</h2>
          <StudioConfigForm 
            onUpdate={handleConfigUpdate} 
            initialData={{ 
              dimensions, 
              humanPosition,
              cameras,
              props,
              ptzTracks 
            }} 
          />
        </Card>
        <Card className="p-6">
          <h2 className="text-lg font-semibold mb-4">Workspace Preview</h2>
          <StudioWorkspace 
            dimensions={dimensions}
            humanPosition={humanPosition}
            cameras={cameras}
            props={props}
            ptzTracks={ptzTracks}
          />
        </Card>
      </div>
    </div>
  );
};