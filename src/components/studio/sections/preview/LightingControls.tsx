
import React from 'react';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Sun, SunMedium, Sparkles } from 'lucide-react';

interface LightingControlsProps {
  lightMode: 'basic' | 'product' | 'visualization';
  onLightModeChange: (mode: 'basic' | 'product' | 'visualization') => void;
}

export const LightingControls: React.FC<LightingControlsProps> = ({
  lightMode,
  onLightModeChange
}) => {
  return (
    <div className="bg-background/80 backdrop-blur-sm p-2 rounded-lg shadow-md">
      <ToggleGroup type="single" value={lightMode} onValueChange={(value) => {
        if (value) onLightModeChange(value as 'basic' | 'product' | 'visualization');
      }}>
        <ToggleGroupItem value="basic" aria-label="Basic Lighting" title="Basic Studio Lighting">
          <Sun className="h-4 w-4 mr-1" />
          <span className="sr-only md:not-sr-only md:text-xs">Basic</span>
        </ToggleGroupItem>
        
        <ToggleGroupItem value="product" aria-label="Product Lighting" title="Enhanced Product Lighting">
          <SunMedium className="h-4 w-4 mr-1" />
          <span className="sr-only md:not-sr-only md:text-xs">Product</span>
        </ToggleGroupItem>
        
        <ToggleGroupItem value="visualization" aria-label="Visualization Lighting" title="Optimized for Data Visualization">
          <Sparkles className="h-4 w-4 mr-1" />
          <span className="sr-only md:not-sr-only md:text-xs">Visual</span>
        </ToggleGroupItem>
      </ToggleGroup>
    </div>
  );
};
