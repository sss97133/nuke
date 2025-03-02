
import React from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ArrowUp, ArrowDown, ArrowLeft, ArrowRight, ZoomIn, ZoomOut, Rotate3d } from 'lucide-react';
import type { PTZControlsProps } from '../types/componentTypes';

export const PTZControls: React.FC<PTZControlsProps> = ({ 
  selectedCamera,
  onUpdate,
  onMove
}) => {
  if (!selectedCamera) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>PTZ Camera Controls</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center h-32">
          <p className="text-muted-foreground text-center">
            Select a camera in the studio workspace to control
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>PTZ Camera Controls</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-2 justify-items-center">
          <div />
          <Button variant="outline" size="sm" onClick={() => onMove && onMove('up')}>
            <ArrowUp className="h-4 w-4" />
          </Button>
          <div />
          
          <Button variant="outline" size="sm" onClick={() => onMove && onMove('left')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          
          <Button variant="outline" size="sm" onClick={() => onMove && onMove('center')}>
            <Rotate3d className="h-4 w-4" />
          </Button>
          
          <Button variant="outline" size="sm" onClick={() => onMove && onMove('right')}>
            <ArrowRight className="h-4 w-4" />
          </Button>
          
          <div />
          <Button variant="outline" size="sm" onClick={() => onMove && onMove('down')}>
            <ArrowDown className="h-4 w-4" />
          </Button>
          <div />
        </div>
        
        <div className="flex justify-center gap-2">
          <Button variant="outline" size="sm" onClick={() => onMove && onMove('zoomIn')}>
            <ZoomIn className="h-4 w-4 mr-1" /> In
          </Button>
          <Button variant="outline" size="sm" onClick={() => onMove && onMove('zoomOut')}>
            <ZoomOut className="h-4 w-4 mr-1" /> Out
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
