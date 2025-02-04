import React from 'react';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';

interface AudioControlsProps {
  audioLevel: number[];
  setAudioLevel: (value: number[]) => void;
}

export const AudioControls = ({ audioLevel, setAudioLevel }: AudioControlsProps) => {
  return (
    <Card className="p-6">
      <h3 className="text-lg font-semibold mb-4">Audio Controls</h3>
      <div className="space-y-6">
        <div className="space-y-2">
          <Label>Master Volume</Label>
          <Slider
            value={audioLevel}
            onValueChange={setAudioLevel}
            max={100}
            step={1}
          />
        </div>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Label>Noise Reduction</Label>
            <Switch />
          </div>
          <div className="flex items-center justify-between">
            <Label>Echo Cancellation</Label>
            <Switch />
          </div>
          <div className="flex items-center justify-between">
            <Label>Auto Gain</Label>
            <Switch />
          </div>
        </div>
      </div>
    </Card>
  );
};