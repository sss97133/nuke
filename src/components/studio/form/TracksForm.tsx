
import React from 'react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Plus } from 'lucide-react';
import { TrackForm } from './TrackForm';

interface TracksFormProps {
  tracks: {
    position: {
      x: string;
      y: string;
      z: string;
    };
    length: string;
    speed: string;
    coneAngle: string;
  }[];
  addTrack: () => void;
  removeTrack: (index: number) => void;
  handleTrackChange: (index: number, field: string, value: string) => void;
}

export const TracksForm: React.FC<TracksFormProps> = ({
  tracks,
  addTrack,
  removeTrack,
  handleTrackChange
}) => {
  return (
    <div>
      <Separator className="my-6" />
      
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
        
        {tracks.map((track, index) => (
          <TrackForm
            key={index}
            track={track}
            index={index}
            handleTrackChange={handleTrackChange}
            removeTrack={removeTrack}
          />
        ))}
      </div>
    </div>
  );
};
