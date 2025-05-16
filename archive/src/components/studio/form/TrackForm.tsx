
import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Trash, Camera } from 'lucide-react';

interface TrackFormProps {
  track: {
    position: {
      x: string;
      y: string;
      z: string;
    };
    length: string;
    speed: string;
    coneAngle: string;
  };
  index: number;
  handleTrackChange: (index: number, field: string, value: string) => void;
  removeTrack: (index: number) => void;
}

export const TrackForm: React.FC<TrackFormProps> = ({
  track,
  index,
  handleTrackChange,
  removeTrack
}) => {
  return (
    <div className="border p-4 rounded-md mb-4">
      <div className="flex justify-between items-center mb-2">
        <div className="flex items-center">
          <Camera className="h-4 w-4 mr-1 text-primary" />
          <h4 className="font-medium">Track {index + 1}</h4>
        </div>
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
      
      <div className="space-y-4">
        <div>
          <Label className="block mb-1">Camera Position</Label>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <Label htmlFor={`track-${index}-pos-x`} className="text-xs">X Position</Label>
              <Input
                id={`track-${index}-pos-x`}
                type="number"
                value={track.position.x}
                onChange={(e) => handleTrackChange(index, 'position.x', e.target.value)}
                className="mt-1"
                min="-50"
                max="50"
              />
            </div>
            <div>
              <Label htmlFor={`track-${index}-pos-y`} className="text-xs">Y Position</Label>
              <Input
                id={`track-${index}-pos-y`}
                type="number"
                value={track.position.y}
                onChange={(e) => handleTrackChange(index, 'position.y', e.target.value)}
                className="mt-1"
                min="0"
                max="30"
              />
            </div>
            <div>
              <Label htmlFor={`track-${index}-pos-z`} className="text-xs">Z Position</Label>
              <Input
                id={`track-${index}-pos-z`}
                type="number"
                value={track.position.z}
                onChange={(e) => handleTrackChange(index, 'position.z', e.target.value)}
                className="mt-1"
                min="-50"
                max="50"
              />
            </div>
          </div>
        </div>
        
        <div>
          <Label htmlFor={`track-${index}-length`} className="block mb-1">Field of View Length</Label>
          <Input
            id={`track-${index}-length`}
            type="number"
            value={track.length}
            onChange={(e) => handleTrackChange(index, 'length', e.target.value)}
            min="1"
            max="20"
            step="0.5"
          />
          <p className="text-xs text-muted-foreground mt-1">
            How far the camera's field of view extends (in meters)
          </p>
        </div>
        
        <div>
          <Label htmlFor={`track-${index}-cone`} className="block mb-1">Field of View Angle (°)</Label>
          <Input
            id={`track-${index}-cone`}
            type="number"
            value={track.coneAngle}
            onChange={(e) => handleTrackChange(index, 'coneAngle', e.target.value)}
            min="10"
            max="120"
          />
          <p className="text-xs text-muted-foreground mt-1">
            The cone angle represents your camera's field of view (FOV)
          </p>
        </div>
        
        <div>
          <Label htmlFor={`track-${index}-speed`} className="block mb-1">Camera Speed</Label>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Slow</span>
            <Slider 
              id={`track-${index}-speed-slider`}
              value={[parseFloat(track.speed)]}
              min={0.1}
              max={5}
              step={0.1}
              onValueChange={(values) => handleTrackChange(index, 'speed', values[0].toString())}
              className="flex-1"
            />
            <span className="text-sm text-muted-foreground">Fast</span>
          </div>
          <Input
            id={`track-${index}-speed`}
            type="number"
            value={track.speed}
            onChange={(e) => handleTrackChange(index, 'speed', e.target.value)}
            min="0.1"
            max="5"
            step="0.1"
            className="mt-2"
          />
        </div>
      </div>
    </div>
  );
};
