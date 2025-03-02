
import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PlayCircle, PauseCircle, Film, Download } from 'lucide-react';
import type { RecordingControlsProps } from '../types/componentTypes';

export const RecordingControls: React.FC<RecordingControlsProps> = ({ onStart, onStop }) => {
  const [isRecording, setIsRecording] = useState(false);
  
  const handleToggleRecording = () => {
    if (isRecording) {
      onStop();
    } else {
      onStart();
    }
    setIsRecording(!isRecording);
  };
  
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Resolution</Label>
        <Select defaultValue="1080p">
          <SelectTrigger>
            <SelectValue placeholder="Select resolution" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="720p">720p</SelectItem>
            <SelectItem value="1080p">1080p</SelectItem>
            <SelectItem value="4k">4K UHD</SelectItem>
          </SelectContent>
        </Select>
      </div>
      
      <div className="space-y-2">
        <Label>Frame Rate</Label>
        <Select defaultValue="30">
          <SelectTrigger>
            <SelectValue placeholder="Select frame rate" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="24">24 fps</SelectItem>
            <SelectItem value="30">30 fps</SelectItem>
            <SelectItem value="60">60 fps</SelectItem>
          </SelectContent>
        </Select>
      </div>
      
      <div className="flex justify-between mt-4">
        <Button
          variant={isRecording ? "destructive" : "default"}
          size="sm"
          className="flex-1 mr-2"
          onClick={handleToggleRecording}
        >
          {isRecording ? (
            <>
              <PauseCircle className="h-4 w-4 mr-2" />
              Stop Recording
            </>
          ) : (
            <>
              <PlayCircle className="h-4 w-4 mr-2" />
              Start Recording
            </>
          )}
        </Button>
        
        <Button variant="outline" size="sm">
          <Film className="h-4 w-4 mr-2" />
          Snapshot
        </Button>
      </div>
      
      <Button variant="outline" size="sm" className="w-full" disabled={!isRecording}>
        <Download className="h-4 w-4 mr-2" />
        Export Recording
      </Button>
    </div>
  );
};
