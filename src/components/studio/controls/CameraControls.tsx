
import React, { useState } from 'react';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';
import type { CameraControlsProps } from '../types/componentTypes';

export const CameraControls: React.FC<CameraControlsProps> = ({ onZoom }) => {
  const [zoomLevel, setZoomLevel] = useState(1);
  const [focusDistance, setFocusDistance] = useState(50);
  const [aperture, setAperture] = useState(5.6);
  
  const handleZoomChange = (value: number[]) => {
    const newZoom = value[0];
    setZoomLevel(newZoom);
    onZoom(newZoom);
  };
  
  const handleFocusChange = (value: number[]) => {
    setFocusDistance(value[0]);
  };
  
  const handleApertureChange = (value: number[]) => {
    setAperture(value[0]);
  };
  
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <Label>Zoom</Label>
          <span className="text-xs text-muted-foreground">{zoomLevel.toFixed(1)}x</span>
        </div>
        <Slider
          value={[zoomLevel]}
          min={1}
          max={10}
          step={0.1}
          onValueChange={handleZoomChange}
        />
      </div>
      
      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <Label>Focus</Label>
          <span className="text-xs text-muted-foreground">{focusDistance.toFixed(1)} cm</span>
        </div>
        <Slider
          value={[focusDistance]}
          min={10}
          max={500}
          step={1}
          onValueChange={handleFocusChange}
        />
      </div>
      
      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <Label>Aperture</Label>
          <span className="text-xs text-muted-foreground">f/{aperture.toFixed(1)}</span>
        </div>
        <Slider
          value={[aperture]}
          min={1.4}
          max={22}
          step={0.1}
          onValueChange={handleApertureChange}
        />
      </div>
      
      <Button variant="outline" size="sm" className="w-full">
        <RefreshCw className="h-4 w-4 mr-2" />
        Auto Focus
      </Button>
    </div>
  );
};
