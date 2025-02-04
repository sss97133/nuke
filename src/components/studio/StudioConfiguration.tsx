import React, { useState } from 'react';
import { StudioWorkspace } from './StudioWorkspace';
import { StudioConfigForm } from './StudioConfigForm';
import { Card } from '@/components/ui/card';

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

export const StudioConfiguration = () => {
  const [dimensions, setDimensions] = useState({
    length: 30,
    width: 20,
    height: 16,
  });

  const [ptzTracks, setPtzTracks] = useState([
    {
      position: { x: 0, y: 8, z: 0 },
      length: 10
    }
  ]);

  const handleConfigUpdate = (data: FormData) => {
    setDimensions({
      length: Number(data.length) || 30,
      width: Number(data.width) || 20,
      height: Number(data.height) || 16,
    });

    if (data.ptzTracks?.[0]) {
      setPtzTracks([
        {
          position: {
            x: Number(data.ptzTracks[0].x) || 0,
            y: Number(data.ptzTracks[0].y) || 8,
            z: Number(data.ptzTracks[0].z) || 0,
          },
          length: Number(data.ptzTracks[0].length) || 10,
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
              ptzTracks 
            }} 
          />
        </Card>
        <Card className="p-6">
          <h2 className="text-lg font-semibold mb-4">Workspace Preview</h2>
          <StudioWorkspace dimensions={dimensions} ptzTracks={ptzTracks} />
        </Card>
      </div>
    </div>
  );
};