
import React, { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Trash2, Plus } from 'lucide-react';
import type { WorkspaceDimensions, PTZTrack } from '@/types/studio';
import type { StudioConfigFormProps } from './types/componentTypes';

export const StudioConfigForm: React.FC<StudioConfigFormProps> = ({
  initialDimensions,
  initialPTZTracks,
  onUpdateDimensions,
  onUpdatePTZTracks
}) => {
  const [studioName, setStudioName] = useState('Default Studio');
  const [width, setWidth] = useState(initialDimensions.width);
  const [length, setLength] = useState(initialDimensions.length);
  const [height, setHeight] = useState(initialDimensions.height);
  const [tracks, setTracks] = useState<PTZTrack[]>(initialPTZTracks);

  useEffect(() => {
    setWidth(initialDimensions.width);
    setLength(initialDimensions.length);
    setHeight(initialDimensions.height);
  }, [initialDimensions]);

  useEffect(() => {
    setTracks(initialPTZTracks);
  }, [initialPTZTracks]);

  const handleDimensionChange = () => {
    onUpdateDimensions({
      width,
      length,
      height
    });
  };

  const handleTrackChange = (index: number, field: keyof PTZTrack, value: any) => {
    const updatedTracks = [...tracks];
    
    if (field === 'position.x' || field === 'position.y' || field === 'position.z') {
      // Handle nested position object
      const positionField = field.split('.')[1] as keyof typeof updatedTracks[0]['position'];
      updatedTracks[index] = {
        ...updatedTracks[index],
        position: {
          ...updatedTracks[index].position,
          [positionField]: value
        }
      };
    } else {
      // Handle direct fields
      updatedTracks[index] = {
        ...updatedTracks[index],
        [field]: value
      };
    }
    
    setTracks(updatedTracks);
    onUpdatePTZTracks(updatedTracks);
  };

  const handleAddTrack = () => {
    const newTrack: PTZTrack = {
      position: { x: 0, y: height / 2, z: 0 },
      length: 10,
      speed: 1,
      coneAngle: 45
    };
    
    const updatedTracks = [...tracks, newTrack];
    setTracks(updatedTracks);
    onUpdatePTZTracks(updatedTracks);
  };

  const handleDeleteTrack = (index: number) => {
    const updatedTracks = tracks.filter((_, i) => i !== index);
    setTracks(updatedTracks);
    onUpdatePTZTracks(updatedTracks);
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-4">
          <div>
            <Label htmlFor="studioName">Studio Name</Label>
            <Input 
              id="studioName" 
              value={studioName} 
              onChange={e => setStudioName(e.target.value)} 
            />
          </div>
          
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Workspace Dimensions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <Label htmlFor="width">Width</Label>
                    <span className="text-sm text-muted-foreground">{width} units</span>
                  </div>
                  <Slider
                    id="width"
                    value={[width]}
                    min={5}
                    max={50}
                    step={1}
                    onValueChange={values => setWidth(values[0])}
                    onValueCommit={handleDimensionChange}
                  />
                </div>
                
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <Label htmlFor="length">Length</Label>
                    <span className="text-sm text-muted-foreground">{length} units</span>
                  </div>
                  <Slider
                    id="length"
                    value={[length]}
                    min={5}
                    max={50}
                    step={1}
                    onValueChange={values => setLength(values[0])}
                    onValueCommit={handleDimensionChange}
                  />
                </div>
                
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <Label htmlFor="height">Height</Label>
                    <span className="text-sm text-muted-foreground">{height} units</span>
                  </div>
                  <Slider
                    id="height"
                    value={[height]}
                    min={3}
                    max={30}
                    step={1}
                    onValueChange={values => setHeight(values[0])}
                    onValueCommit={handleDimensionChange}
                  />
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
        
        <div>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>PTZ Camera Tracks</CardTitle>
              <Button variant="outline" size="sm" onClick={handleAddTrack}>
                <Plus className="h-4 w-4 mr-1" /> Add Track
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              {tracks.map((track, index) => (
                <Card key={index} className="p-4">
                  <div className="flex justify-between mb-2">
                    <h4 className="font-medium">Camera Track {index + 1}</h4>
                    <Button 
                      variant="ghost" 
                      size="icon"
                      className="h-6 w-6 text-destructive"
                      onClick={() => handleDeleteTrack(index)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <Label htmlFor={`track-${index}-x`}>Position X</Label>
                      <Input
                        id={`track-${index}-x`}
                        type="number"
                        value={track.position.x}
                        onChange={e => handleTrackChange(index, 'position.x', parseFloat(e.target.value))}
                      />
                    </div>
                    
                    <div className="space-y-1">
                      <Label htmlFor={`track-${index}-y`}>Position Y</Label>
                      <Input
                        id={`track-${index}-y`}
                        type="number"
                        value={track.position.y}
                        onChange={e => handleTrackChange(index, 'position.y', parseFloat(e.target.value))}
                      />
                    </div>
                    
                    <div className="space-y-1">
                      <Label htmlFor={`track-${index}-z`}>Position Z</Label>
                      <Input
                        id={`track-${index}-z`}
                        type="number"
                        value={track.position.z}
                        onChange={e => handleTrackChange(index, 'position.z', parseFloat(e.target.value))}
                      />
                    </div>
                    
                    <div className="space-y-1">
                      <Label htmlFor={`track-${index}-length`}>Track Length</Label>
                      <Input
                        id={`track-${index}-length`}
                        type="number"
                        value={track.length}
                        onChange={e => handleTrackChange(index, 'length', parseFloat(e.target.value))}
                      />
                    </div>
                    
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <Label htmlFor={`track-${index}-speed`}>Camera Speed</Label>
                        <span className="text-sm text-muted-foreground">{track.speed}x</span>
                      </div>
                      <Slider
                        id={`track-${index}-speed`}
                        value={[track.speed]}
                        min={0.1}
                        max={5}
                        step={0.1}
                        onValueChange={values => handleTrackChange(index, 'speed', values[0])}
                      />
                    </div>
                    
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <Label htmlFor={`track-${index}-cone`}>Cone Angle</Label>
                        <span className="text-sm text-muted-foreground">{track.coneAngle}°</span>
                      </div>
                      <Slider
                        id={`track-${index}-cone`}
                        value={[track.coneAngle]}
                        min={10}
                        max={120}
                        step={1}
                        onValueChange={values => handleTrackChange(index, 'coneAngle', values[0])}
                      />
                    </div>
                  </div>
                </Card>
              ))}
              
              {tracks.length === 0 && (
                <div className="text-center py-4 text-muted-foreground">
                  <p>No camera tracks configured.</p>
                  <p className="text-sm">Click "Add Track" to create a new camera track.</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};
