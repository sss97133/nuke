
import React from 'react';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Volume2, VolumeX, Plus } from 'lucide-react';
import type { AudioControlsProps } from '../types/componentTypes';

export const AudioControls: React.FC<AudioControlsProps> = ({ levels, onLevelChange }) => {
  const handleAddChannel = () => {
    // Would add a new audio channel
    onLevelChange(levels.length, 50);
  };
  
  const handleMuteChannel = (index: number) => {
    onLevelChange(index, 0);
  };
  
  return (
    <div className="space-y-4">
      {levels.map((level, index) => (
        <div key={index} className="space-y-2">
          <div className="flex justify-between items-center">
            <Label>Channel {index + 1}</Label>
            <span className="text-xs text-muted-foreground">{level}%</span>
          </div>
          <div className="flex items-center gap-2">
            <Button 
              variant="ghost" 
              size="icon"
              className="h-8 w-8"
              onClick={() => handleMuteChannel(index)}
            >
              <VolumeX className="h-4 w-4" />
            </Button>
            <Slider
              value={[level]}
              min={0}
              max={100}
              step={1}
              className="flex-1"
              onValueChange={(value) => onLevelChange(index, value[0])}
            />
            <Button 
              variant="ghost" 
              size="icon"
              className="h-8 w-8"
            >
              <Volume2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ))}
      
      <Button 
        variant="outline" 
        size="sm" 
        className="w-full"
        onClick={handleAddChannel}
      >
        <Plus className="h-4 w-4 mr-2" />
        Add Audio Channel
      </Button>
    </div>
  );
};
