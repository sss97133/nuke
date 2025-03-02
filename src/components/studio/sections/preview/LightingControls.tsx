
import React from 'react';
import { Button } from '@/components/ui/button';
import { SunIcon, Lightbulb } from 'lucide-react';

interface LightingControlsProps {
  lightMode: 'basic' | 'product';
  onLightModeChange: (mode: 'basic' | 'product') => void;
}

export const LightingControls: React.FC<LightingControlsProps> = ({ 
  lightMode, 
  onLightModeChange 
}) => {
  return (
    <div className="flex space-x-2">
      <Button 
        variant={lightMode === 'basic' ? "default" : "outline"} 
        size="sm"
        onClick={() => onLightModeChange('basic')}
      >
        <SunIcon className="h-4 w-4 mr-2" />
        Studio Lighting
      </Button>
      <Button 
        variant={lightMode === 'product' ? "default" : "outline"} 
        size="sm"
        onClick={() => onLightModeChange('product')}
      >
        <Lightbulb className="h-4 w-4 mr-2" />
        Product Lighting
      </Button>
    </div>
  );
};
