import React from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';

interface PTZConfigSectionProps {
  register: any;
  ptzTrack: {
    speed: number;
    coneAngle: number;
  };
  onSpeedChange: (value: number[]) => void;
  onConeAngleChange: (value: number[]) => void;
}

export const PTZConfigSection = ({ 
  register, 
  ptzTrack,
  onSpeedChange,
  onConeAngleChange 
}: PTZConfigSectionProps) => {
  return (
    <div className="grid grid-cols-2 gap-4">
      <div>
        <Label htmlFor="ptz-x">Track X Position</Label>
        <Input
          id="ptz-x"
          type="number"
          {...register('ptzTracks.0.x', { required: true })}
          placeholder="0"
        />
      </div>
      <div>
        <Label htmlFor="ptz-y">Track Y Position</Label>
        <Input
          id="ptz-y"
          type="number"
          {...register('ptzTracks.0.y', { required: true })}
          placeholder="8"
        />
      </div>
      <div>
        <Label htmlFor="ptz-z">Track Z Position</Label>
        <Input
          id="ptz-z"
          type="number"
          {...register('ptzTracks.0.z', { required: true })}
          placeholder="0"
        />
      </div>
      <div>
        <Label htmlFor="ptz-length">Track Length</Label>
        <Input
          id="ptz-length"
          type="number"
          {...register('ptzTracks.0.length', { required: true, min: 1 })}
          placeholder="10"
        />
      </div>
      <div>
        <Label htmlFor="ptz-speed">Camera Movement Speed</Label>
        <Slider
          id="ptz-speed"
          min={0.1}
          max={5}
          step={0.1}
          defaultValue={[ptzTrack.speed]}
          onValueChange={onSpeedChange}
        />
      </div>
      <div>
        <Label htmlFor="ptz-cone">Camera Cone Angle (degrees)</Label>
        <Slider
          id="ptz-cone"
          min={10}
          max={120}
          step={5}
          defaultValue={[ptzTrack.coneAngle]}
          onValueChange={onConeAngleChange}
        />
      </div>
    </div>
  );
};