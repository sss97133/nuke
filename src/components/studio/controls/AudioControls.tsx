
import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { Volume2, VolumeX } from 'lucide-react';
import type { AudioControlsProps } from '../types/componentTypes';

export const AudioControls: React.FC<AudioControlsProps> = ({ 
  audioLevel,
  setAudioLevel
}) => {
  const [isMuted, setIsMuted] = React.useState(false);
  const [prevLevel, setPrevLevel] = React.useState(audioLevel);
  
  const handleMuteToggle = () => {
    if (isMuted) {
      // Unmute - restore previous level
      setAudioLevel(prevLevel);
    } else {
      // Mute - save current level and set to 0
      setPrevLevel(audioLevel);
      setAudioLevel(0);
    }
    setIsMuted(!isMuted);
  };
  
  const handleVolumeChange = (value: number[]) => {
    setAudioLevel(value[0]);
    if (value[0] > 0 && isMuted) {
      setIsMuted(false);
    }
  };
  
  return (
    <Card>
      <CardHeader>
        <CardTitle>Audio Controls</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center space-x-4">
          <Button 
            variant="outline" 
            size="icon"
            onClick={handleMuteToggle}
          >
            {isMuted ? <VolumeX /> : <Volume2 />}
          </Button>
          
          <div className="flex-1">
            <Slider
              value={[audioLevel]}
              min={0}
              max={100}
              step={1}
              onValueChange={handleVolumeChange}
            />
          </div>
          
          <div className="w-8 text-center text-sm">
            {audioLevel}%
          </div>
        </div>
        
        <div className="grid grid-cols-2 gap-2">
          <div className="text-xs text-muted-foreground">
            Input: Default Microphone
          </div>
          <div className="text-xs text-muted-foreground text-right">
            Level: {isMuted ? "Muted" : "Active"}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
