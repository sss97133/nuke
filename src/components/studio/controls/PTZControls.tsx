
import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ArrowUp, ArrowDown, ArrowLeft, ArrowRight, ZoomIn, ZoomOut, Crosshair } from 'lucide-react';
import type { PTZControlsProps } from '../types/componentTypes';

export const PTZControls: React.FC<PTZControlsProps> = ({ 
  selectedCamera,
  onUpdate
}) => {
  // If no camera is selected, show placeholder
  if (!selectedCamera) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>PTZ Camera Controls</CardTitle>
        </CardHeader>
        <CardContent className="py-8">
          <div className="text-center text-muted-foreground">
            <Crosshair className="mx-auto h-8 w-8 mb-2 opacity-50" />
            <p>Select a camera in the simulator to control it</p>
          </div>
        </CardContent>
      </Card>
    );
  }
  
  const handlePanTilt = (direction: 'up' | 'down' | 'left' | 'right') => {
    if (!selectedCamera) return;
    
    // Clone the current camera
    const updatedCamera = { ...selectedCamera };
    
    // Create a new target object to avoid direct mutation
    const newTarget = { ...(updatedCamera.target || { x: 0, y: 0, z: 0 }) };
    const step = 1 * selectedCamera.speed;
    
    // Adjust target based on direction
    switch (direction) {
      case 'up':
        newTarget.y += step;
        break;
      case 'down':
        newTarget.y -= step;
        break;
      case 'left':
        newTarget.x -= step;
        break;
      case 'right':
        newTarget.x += step;
        break;
    }
    
    updatedCamera.target = newTarget;
    onUpdate(updatedCamera);
  };
  
  const handleZoom = (direction: 'in' | 'out') => {
    if (!selectedCamera) return;
    
    const updatedCamera = { ...selectedCamera };
    const zoomStep = 0.1;
    
    if (direction === 'in') {
      updatedCamera.zoom = Math.min(3, updatedCamera.zoom + zoomStep);
    } else {
      updatedCamera.zoom = Math.max(0.5, updatedCamera.zoom - zoomStep);
    }
    
    onUpdate(updatedCamera);
  };
  
  const handleSpeedChange = (value: number[]) => {
    if (!selectedCamera) return;
    
    const updatedCamera = { ...selectedCamera };
    updatedCamera.speed = value[0];
    onUpdate(updatedCamera);
  };
  
  return (
    <Card>
      <CardHeader>
        <CardTitle>PTZ Camera Controls: {selectedCamera.name}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex justify-between items-center mb-2">
          <span className="text-sm">Camera ID: {selectedCamera.id}</span>
          <span className="text-sm">Zoom: {selectedCamera.zoom.toFixed(1)}x</span>
        </div>
        
        <div className="grid grid-cols-3 gap-2">
          <div className="col-span-3 flex justify-center">
            <Button variant="outline" onClick={() => handlePanTilt('up')}>
              <ArrowUp className="h-4 w-4" />
            </Button>
          </div>
          
          <div className="flex justify-end">
            <Button variant="outline" onClick={() => handlePanTilt('left')}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </div>
          
          <div className="flex justify-center">
            <Button variant="outline" size="icon">
              <Crosshair className="h-4 w-4" />
            </Button>
          </div>
          
          <div className="flex justify-start">
            <Button variant="outline" onClick={() => handlePanTilt('right')}>
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
          
          <div className="col-span-3 flex justify-center">
            <Button variant="outline" onClick={() => handlePanTilt('down')}>
              <ArrowDown className="h-4 w-4" />
            </Button>
          </div>
        </div>
        
        <div className="flex justify-between space-x-2 mt-4">
          <Button variant="outline" onClick={() => handleZoom('out')}>
            <ZoomOut className="h-4 w-4" />
          </Button>
          
          <Button variant="outline" onClick={() => handleZoom('in')}>
            <ZoomIn className="h-4 w-4" />
          </Button>
        </div>
        
        <div className="space-y-2 mt-4">
          <div className="flex justify-between items-center">
            <span className="text-sm">Movement Speed</span>
            <span className="text-sm">{selectedCamera.speed.toFixed(1)}</span>
          </div>
          
          <Slider
            value={[selectedCamera.speed]}
            min={0.1}
            max={3}
            step={0.1}
            onValueChange={handleSpeedChange}
          />
        </div>
      </CardContent>
    </Card>
  );
};
