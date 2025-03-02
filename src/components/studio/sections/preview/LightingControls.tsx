
import React from 'react';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Sun, SunMedium } from 'lucide-react';

interface LightingControlsProps {
  lightMode: 'basic' | 'product';
  onLightModeChange: (mode: 'basic' | 'product') => void;
}

export const LightingControls: React.FC<LightingControlsProps> = ({
  lightMode,
  onLightModeChange
}) => {
  return (
    <div className="bg-background/80 backdrop-blur-sm p-2 rounded-lg shadow-md">
      <ToggleGroup type="single" value={lightMode} onValueChange={(value) => {
        if (value) onLightModeChange(value as 'basic' | 'product');
      }}>
        <ToggleGroupItem value="basic" aria-label="Basic Lighting" title="Basic Studio Lighting">
          <Sun className="h-4 w-4 mr-1" />
          <span className="sr-only md:not-sr-only md:text-xs">Basic</span>
        </ToggleGroupItem>
        
        <ToggleGroupItem value="product" aria-label="Product Lighting" title="Enhanced Product Lighting">
          <SunMedium className="h-4 w-4 mr-1" />
          <span className="sr-only md:not-sr-only md:text-xs">Product</span>
        </ToggleGroupItem>
      </ToggleGroup>
    </div>
  );
};
