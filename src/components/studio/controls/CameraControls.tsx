
import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Camera, Image, RefreshCw } from 'lucide-react';
import type { CameraControlsProps } from '../types/componentTypes';

export const CameraControls: React.FC<CameraControlsProps> = ({ onZoom }) => {
  const [exposureValue, setExposureValue] = useState(50);
  const [focusValue, setFocusValue] = useState(70);
  const [isAutoFocus, setIsAutoFocus] = useState(true);
  
  return (
    <Card>
      <CardHeader>
        <CardTitle>Camera Controls</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="flex justify-between">
            <Label>Exposure</Label>
            <span className="text-xs text-muted-foreground">{exposureValue}%</span>
          </div>
          <Slider
            value={[exposureValue]}
            min={0}
            max={100}
            step={1}
            onValueChange={(value) => setExposureValue(value[0])}
          />
        </div>
        
        <div className="space-y-2">
          <div className="flex justify-between">
            <Label>Focus</Label>
            <span className="text-xs text-muted-foreground">{focusValue}%</span>
          </div>
          <Slider
            value={[focusValue]}
            min={0}
            max={100}
            step={1}
            onValueChange={(value) => setFocusValue(value[0])}
            disabled={isAutoFocus}
          />
        </div>
        
        <div className="flex items-center justify-between">
          <Label htmlFor="auto-focus">Auto Focus</Label>
          <Switch 
            id="auto-focus" 
            checked={isAutoFocus} 
            onCheckedChange={setIsAutoFocus}
          />
        </div>
        
        <div className="grid grid-cols-2 gap-2 pt-2">
          <Button 
            variant="outline" 
            size="sm"
            className="flex items-center gap-1"
          >
            <Camera className="h-4 w-4" />
            Take Snapshot
          </Button>
          <Button 
            variant="outline" 
            size="sm"
            className="flex items-center gap-1"
          >
            <RefreshCw className="h-4 w-4" />
            Reset Settings
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
