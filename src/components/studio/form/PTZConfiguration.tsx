import React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Plus, Minus } from 'lucide-react';
import type { PTZConfigurationProps, PTZTrack } from '@/types/studio';

export const PTZConfiguration = ({ ptzTracks, onUpdate }: PTZConfigurationProps) => {
  const addTrack = () => {
    onUpdate([...ptzTracks, {
      position: { x: 0, y: 8, z: 0 },
      length: 10,
      speed: 1,
      coneAngle: 45,
    }]);
  };

  const removeTrack = (index: number) => {
    onUpdate(ptzTracks.filter((_, i) => i !== index));
  };

  const updateTrack = (index: number, updates: Partial<PTZTrack>) => {
    const newTracks = [...ptzTracks];
    newTracks[index] = { ...newTracks[index], ...updates };
    onUpdate(newTracks);
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button type="button" onClick={addTrack} className="mb-4">
          <Plus className="w-4 h-4 mr-2" />
          Add Track
        </Button>
      </div>
      
      {ptzTracks.map((track, index) => (
        <div key={index} className="border p-4 rounded-lg mb-4">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold">Track {index + 1}</h3>
            {index > 0 && (
              <Button 
                type="button" 
                variant="destructive" 
                onClick={() => removeTrack(index)}
                size="sm"
              >
                <Minus className="w-4 h-4" />
              </Button>
            )}
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Track X Position</Label>
              <Input
                type="number"
                value={track.position.x}
                onChange={(e) => updateTrack(index, { position: { ...track.position, x: Number(e.target.value) } })}
                placeholder="0"
              />
            </div>
            <div>
              <Label>Track Y Position</Label>
              <Input
                type="number"
                value={track.position.y}
                onChange={(e) => updateTrack(index, { position: { ...track.position, y: Number(e.target.value) } })}
                placeholder="8"
              />
            </div>
            <div>
              <Label>Track Z Position</Label>
              <Input
                type="number"
                value={track.position.z}
                onChange={(e) => updateTrack(index, { position: { ...track.position, z: Number(e.target.value) } })}
                placeholder="0"
              />
            </div>
            <div>
              <Label>Track Length</Label>
              <Input
                type="number"
                value={track.length}
                onChange={(e) => updateTrack(index, { length: Number(e.target.value) })}
                placeholder="10"
              />
            </div>
            <div>
              <Label>Camera Movement Speed</Label>
              <Slider
                min={0.1}
                max={5}
                step={0.1}
                value={[track.speed]}
                onValueChange={(value) => updateTrack(index, { speed: value[0] })}
              />
            </div>
            <div>
              <Label>Camera Cone Angle (degrees)</Label>
              <Slider
                min={10}
                max={120}
                step={5}
                value={[track.coneAngle]}
                onValueChange={(value) => updateTrack(index, { coneAngle: value[0] })}
              />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};