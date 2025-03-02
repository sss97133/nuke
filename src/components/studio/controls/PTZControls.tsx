
import React from 'react';
import { Button } from '@/components/ui/button';
import { ArrowUp, ArrowDown, ArrowLeft, ArrowRight, ZoomIn, ZoomOut, Rotate3d } from 'lucide-react';
import type { PTZControlsProps } from '../types/componentTypes';

export const PTZControls: React.FC<PTZControlsProps> = ({ onMove }) => {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2 justify-items-center">
        <div />
        <Button variant="outline" size="sm" onClick={() => onMove('up')}>
          <ArrowUp className="h-4 w-4" />
        </Button>
        <div />
        
        <Button variant="outline" size="sm" onClick={() => onMove('left')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        
        <Button variant="outline" size="sm" onClick={() => onMove('center')}>
          <Rotate3d className="h-4 w-4" />
        </Button>
        
        <Button variant="outline" size="sm" onClick={() => onMove('right')}>
          <ArrowRight className="h-4 w-4" />
        </Button>
        
        <div />
        <Button variant="outline" size="sm" onClick={() => onMove('down')}>
          <ArrowDown className="h-4 w-4" />
        </Button>
        <div />
      </div>
      
      <div className="flex justify-center gap-2">
        <Button variant="outline" size="sm" onClick={() => onMove('zoomIn')}>
          <ZoomIn className="h-4 w-4 mr-1" /> In
        </Button>
        <Button variant="outline" size="sm" onClick={() => onMove('zoomOut')}>
          <ZoomOut className="h-4 w-4 mr-1" /> Out
        </Button>
      </div>
    </div>
  );
};
