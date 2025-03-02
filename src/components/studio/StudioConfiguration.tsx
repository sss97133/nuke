
import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StudioWorkspace } from './StudioWorkspace';
import type { WorkspaceDimensions, PTZTrack } from './types/workspace';

interface StudioConfigurationProps {
  initialDimensions?: WorkspaceDimensions;
  initialTracks?: PTZTrack[];
  onConfigChange?: (config: {
    dimensions: WorkspaceDimensions;
    ptzTracks: PTZTrack[];
  }) => void;
}

export const StudioConfiguration: React.FC<StudioConfigurationProps> = ({
  initialDimensions,
  initialTracks,
  onConfigChange
}) => {
  const [dimensions, setDimensions] = useState<WorkspaceDimensions>(
    initialDimensions || {
      length: 20,
      width: 20,
      height: 10
    }
  );
  
  const [ptzTracks, setPtzTracks] = useState<PTZTrack[]>(
    initialTracks || [
      {
        id: '1',
        name: 'Camera 1',
        position: { x: 8, y: 5, z: 8 },
        rotation: { x: 0, y: 0, z: 0 },
        target: { x: 0, y: 5, z: 0 },
        speed: 1,
        zoom: 1,
        length: 10,
        coneAngle: 45
      }
    ]
  );
  
  const [activeTab, setActiveTab] = useState('dimensions');
  const [selectedCamera, setSelectedCamera] = useState<number>(0);
  
  useEffect(() => {
    if (onConfigChange) {
      onConfigChange({
        dimensions,
        ptzTracks
      });
    }
  }, [dimensions, ptzTracks, onConfigChange]);
  
  const handleDimensionChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    const numValue = parseFloat(value);
    
    if (!isNaN(numValue)) {
      setDimensions(prev => ({
        ...prev,
        [name]: numValue
      }));
    }
  };
  
  const handleAddCamera = () => {
    const newCamera: PTZTrack = {
      id: `camera-${ptzTracks.length + 1}`,
      name: `Camera ${ptzTracks.length + 1}`,
      position: { x: 0, y: 5, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      target: { x: 0, y: 5, z: 0 },
      speed: 1,
      zoom: 1,
      length: 10,
      coneAngle: 45
    };
    
    setPtzTracks([...ptzTracks, newCamera]);
    setSelectedCamera(ptzTracks.length);
  };
  
  const handleRemoveCamera = (index: number) => {
    const newTracks = ptzTracks.filter((_, i) => i !== index);
    setPtzTracks(newTracks);
    
    if (selectedCamera >= newTracks.length) {
      setSelectedCamera(Math.max(0, newTracks.length - 1));
    }
  };
  
  const handleCameraPositionChange = (
    index: number,
    axis: 'x' | 'y' | 'z',
    value: string
  ) => {
    const numValue = parseFloat(value);
    
    if (!isNaN(numValue)) {
      const updatedTracks = [...ptzTracks];
      updatedTracks[index] = {
        ...updatedTracks[index],
        position: {
          ...updatedTracks[index].position,
          [axis]: numValue
        }
      };
      
      setPtzTracks(updatedTracks);
    }
  };
  
  const handleCameraSettingChange = (
    index: number,
    property: 'speed' | 'zoom' | 'length' | 'coneAngle',
    value: string
  ) => {
    const numValue = parseFloat(value);
    
    if (!isNaN(numValue)) {
      const updatedTracks = [...ptzTracks];
      updatedTracks[index] = {
        ...updatedTracks[index],
        [property]: numValue
      };
      
      setPtzTracks(updatedTracks);
    }
  };
  
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2">
        <Card className="mb-6">
          <CardContent className="p-0 overflow-hidden">
            <StudioWorkspace
              dimensions={dimensions}
              ptzTracks={ptzTracks}
              selectedCameraIndex={selectedCamera}
              onCameraSelect={setSelectedCamera}
            />
          </CardContent>
        </Card>
      </div>
      
      <div>
        <Card>
          <CardHeader>
            <CardTitle>Studio Configuration</CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="mb-4">
                <TabsTrigger value="dimensions">Dimensions</TabsTrigger>
                <TabsTrigger value="cameras">Cameras</TabsTrigger>
              </TabsList>
              
              <TabsContent value="dimensions">
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      Length (m)
                    </label>
                    <Input
                      type="number"
                      name="length"
                      value={dimensions.length}
                      onChange={handleDimensionChange}
                      min={5}
                      max={50}
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      Width (m)
                    </label>
                    <Input
                      type="number"
                      name="width"
                      value={dimensions.width}
                      onChange={handleDimensionChange}
                      min={5}
                      max={50}
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      Height (m)
                    </label>
                    <Input
                      type="number"
                      name="height"
                      value={dimensions.height}
                      onChange={handleDimensionChange}
                      min={2}
                      max={20}
                    />
                  </div>
                </div>
              </TabsContent>
              
              <TabsContent value="cameras">
                <div className="space-y-4">
                  <Button onClick={handleAddCamera} className="w-full">
                    Add Camera
                  </Button>
                  
                  {ptzTracks.map((track, index) => (
                    <div key={track.id} className="border p-3 rounded-md">
                      <div className="flex justify-between items-center mb-2">
                        <h3 className="font-medium">{track.name}</h3>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleRemoveCamera(index)}
                          disabled={ptzTracks.length <= 1}
                        >
                          Remove
                        </Button>
                      </div>
                      
                      <div className="grid grid-cols-3 gap-2 mb-2">
                        <div>
                          <label className="block text-xs mb-1">X Position</label>
                          <Input
                            type="number"
                            value={track.position.x}
                            onChange={(e) =>
                              handleCameraPositionChange(index, 'x', e.target.value)
                            }
                            min={-dimensions.length / 2}
                            max={dimensions.length / 2}
                            step={0.5}
                          />
                        </div>
                        
                        <div>
                          <label className="block text-xs mb-1">Y Position</label>
                          <Input
                            type="number"
                            value={track.position.y}
                            onChange={(e) =>
                              handleCameraPositionChange(index, 'y', e.target.value)
                            }
                            min={0}
                            max={dimensions.height}
                            step={0.5}
                          />
                        </div>
                        
                        <div>
                          <label className="block text-xs mb-1">Z Position</label>
                          <Input
                            type="number"
                            value={track.position.z}
                            onChange={(e) =>
                              handleCameraPositionChange(index, 'z', e.target.value)
                            }
                            min={-dimensions.width / 2}
                            max={dimensions.width / 2}
                            step={0.5}
                          />
                        </div>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-xs mb-1">Speed</label>
                          <Input
                            type="number"
                            value={track.speed}
                            onChange={(e) =>
                              handleCameraSettingChange(index, 'speed', e.target.value)
                            }
                            min={0.1}
                            max={5}
                            step={0.1}
                          />
                        </div>
                        
                        <div>
                          <label className="block text-xs mb-1">Zoom</label>
                          <Input
                            type="number"
                            value={track.zoom}
                            onChange={(e) =>
                              handleCameraSettingChange(index, 'zoom', e.target.value)
                            }
                            min={0.5}
                            max={3}
                            step={0.1}
                          />
                        </div>
                        
                        <div>
                          <label className="block text-xs mb-1">Cone Length</label>
                          <Input
                            type="number"
                            value={track.length || 10}
                            onChange={(e) =>
                              handleCameraSettingChange(index, 'length', e.target.value)
                            }
                            min={2}
                            max={20}
                            step={0.5}
                          />
                        </div>
                        
                        <div>
                          <label className="block text-xs mb-1">Cone Angle (°)</label>
                          <Input
                            type="number"
                            value={track.coneAngle || 45}
                            onChange={(e) =>
                              handleCameraSettingChange(index, 'coneAngle', e.target.value)
                            }
                            min={10}
                            max={120}
                            step={1}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
