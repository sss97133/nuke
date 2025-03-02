
import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Trash } from 'lucide-react';

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
  );
};
