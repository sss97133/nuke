
import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Volume2, VolumeX, Plus } from 'lucide-react';
import type { AudioControlsProps } from '../types/componentTypes';

export const AudioControls: React.FC<AudioControlsProps> = ({ 
  audioLevel, 
  setAudioLevel 
}) => {
  const handleAddChannel = () => {
    setAudioLevel(prev => [...prev, 50]);
  };
  
  const handleMuteChannel = (index: number) => {
    setAudioLevel(prev => {
      const newLevels = [...prev];
      newLevels[index] = 0;
      return newLevels;
    });
  };
  
  return (
    <Card>
      <CardHeader>
        <CardTitle>Audio Controls</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {audioLevel.map((level, index) => (
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
                onValueChange={(value) => {
                  const newLevels = [...audioLevel];
                  newLevels[index] = value[0];
                  setAudioLevel(newLevels);
                }}
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
      </CardContent>
    </Card>
  );
};
