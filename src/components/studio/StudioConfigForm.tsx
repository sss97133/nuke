
import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Plus, Trash } from 'lucide-react';
import type { StudioConfigFormProps } from './types/componentTypes';
import type { PTZTrack } from './types/workspace';

export const StudioConfigForm: React.FC<StudioConfigFormProps> = ({ 
  initialData,
  onUpdate
}) => {
  const [formData, setFormData] = useState({
    length: initialData.dimensions.length.toString(),
    width: initialData.dimensions.width.toString(),
    height: initialData.dimensions.height.toString(),
    ptzTracks: initialData.ptzTracks.map(track => ({
      position: {
        x: track.position.x.toString(),
        y: track.position.y.toString(),
        z: track.position.z.toString()
      },
      length: track.length.toString(),
      speed: track.speed.toString(),
      coneAngle: track.coneAngle.toString()
    }))
  });
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    onUpdate({
      length: Number(formData.length),
      width: Number(formData.width),
      height: Number(formData.height),
      ptzTracks: formData.ptzTracks.map(track => ({
        position: {
          x: Number(track.position.x),
          y: Number(track.position.y),
          z: Number(track.position.z)
        },
        length: Number(track.length),
        speed: Number(track.speed),
        coneAngle: Number(track.coneAngle)
      }))
    });
  };
  
  const handleDimensionChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };
  
  const handleTrackChange = (index: number, field: string, value: string) => {
    setFormData(prev => {
      const updatedTracks = [...prev.ptzTracks];
      
      // Handle nested position properties
      if (field.startsWith('position.')) {
        const posKey = field.split('.')[1] as 'x' | 'y' | 'z';
        updatedTracks[index] = {
          ...updatedTracks[index],
          position: {
            ...updatedTracks[index].position,
            [posKey]: value
          }
        };
      } else {
        updatedTracks[index] = {
          ...updatedTracks[index],
          [field]: value
        };
      }
      
      return {
        ...prev,
        ptzTracks: updatedTracks
      };
    });
  };
  
  const addTrack = () => {
    setFormData(prev => ({
      ...prev,
      ptzTracks: [
        ...prev.ptzTracks,
        {
          position: { x: '0', y: '8', z: '0' },
          length: '10',
          speed: '1',
          coneAngle: '45'
        }
      ]
    }));
  };
  
  const removeTrack = (index: number) => {
    setFormData(prev => ({
      ...prev,
      ptzTracks: prev.ptzTracks.filter((_, i) => i !== index)
    }));
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <h3 className="text-lg font-medium mb-4">Studio Dimensions</h3>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <Label htmlFor="length">Length (feet)</Label>
            <Input
              id="length"
              name="length"
              type="number"
              value={formData.length}
              onChange={handleDimensionChange}
              min="1"
              max="100"
            />
          </div>
          <div>
            <Label htmlFor="width">Width (feet)</Label>
            <Input
              id="width"
              name="width"
              type="number"
              value={formData.width}
              onChange={handleDimensionChange}
              min="1"
              max="100"
            />
          </div>
          <div>
            <Label htmlFor="height">Height (feet)</Label>
            <Input
              id="height"
              name="height"
              type="number"
              value={formData.height}
              onChange={handleDimensionChange}
              min="1"
              max="50"
            />
          </div>
        </div>
      </div>
      
      <Separator />
      
      <div>
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-medium">PTZ Camera Tracks</h3>
          <Button 
            type="button" 
            onClick={addTrack}
            size="sm"
            className="flex items-center gap-1"
          >
            <Plus className="h-4 w-4" />
            Add Track
          </Button>
        </div>
        
        {formData.ptzTracks.map((track, index) => (
          <div key={index} className="border p-4 rounded-md mb-4">
            <div className="flex justify-between items-center mb-2">
              <h4 className="font-medium">Track {index + 1}</h4>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={() => removeTrack(index)}
                className="flex items-center gap-1"
              >
                <Trash className="h-4 w-4" />
                Remove
              </Button>
            </div>
            
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div>
                <Label htmlFor={`track-${index}-pos-x`}>Position X</Label>
                <Input
                  id={`track-${index}-pos-x`}
                  type="number"
                  value={track.position.x}
                  onChange={(e) => handleTrackChange(index, 'position.x', e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor={`track-${index}-pos-y`}>Position Y</Label>
                <Input
                  id={`track-${index}-pos-y`}
                  type="number"
                  value={track.position.y}
                  onChange={(e) => handleTrackChange(index, 'position.y', e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor={`track-${index}-pos-z`}>Position Z</Label>
                <Input
                  id={`track-${index}-pos-z`}
                  type="number"
                  value={track.position.z}
                  onChange={(e) => handleTrackChange(index, 'position.z', e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor={`track-${index}-length`}>Track Length</Label>
                <Input
                  id={`track-${index}-length`}
                  type="number"
                  value={track.length}
                  onChange={(e) => handleTrackChange(index, 'length', e.target.value)}
                  min="1"
                />
              </div>
              <div>
                <Label htmlFor={`track-${index}-speed`}>Camera Speed</Label>
                <Input
                  id={`track-${index}-speed`}
                  type="number"
                  value={track.speed}
                  onChange={(e) => handleTrackChange(index, 'speed', e.target.value)}
                  min="0.1"
                  max="10"
                  step="0.1"
                />
              </div>
              <div>
                <Label htmlFor={`track-${index}-cone`}>Cone Angle (°)</Label>
                <Input
                  id={`track-${index}-cone`}
                  type="number"
                  value={track.coneAngle}
                  onChange={(e) => handleTrackChange(index, 'coneAngle', e.target.value)}
                  min="10"
                  max="120"
                />
              </div>
            </div>
          </div>
        ))}
      </div>
      
      <div className="flex justify-end">
        <Button type="submit">
          Update Configuration
        </Button>
      </div>
    </form>
  );
};
