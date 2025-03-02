
import React from 'react';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { 
  Sun, 
  Sliders, 
  RotateCw, 
  LayoutGrid, 
  ZoomIn, 
  ZoomOut, 
  Camera, 
  Eye,
  LineChart
} from 'lucide-react';

interface LightingControlsProps {
  lightMode: 'basic' | 'product' | 'visualization';
  onLightModeChange: (mode: 'basic' | 'product' | 'visualization') => void;
}

export const LightingControls: React.FC<LightingControlsProps> = ({
  lightMode,
  onLightModeChange
}) => {
  return (
    <div className="bg-background/80 backdrop-blur-sm p-3 rounded-lg shadow-md space-y-3">
      {/* Lighting Toggle - Render Controls */}
      <div>
        <div className="text-xs font-medium mb-1.5 text-muted-foreground">Lighting</div>
        <ToggleGroup type="single" value={lightMode} onValueChange={(value) => {
          if (value) onLightModeChange(value as 'basic' | 'product' | 'visualization');
        }}>
          <ToggleGroupItem value="basic" aria-label="Basic Lighting" title="Basic Studio Lighting">
            <Sun className="h-4 w-4 mr-1" />
            <span className="sr-only md:not-sr-only md:text-xs">Basic</span>
          </ToggleGroupItem>
          <ToggleGroupItem value="product" aria-label="Product Lighting" title="Enhanced Product Lighting">
            <Camera className="h-4 w-4 mr-1" />
            <span className="sr-only md:not-sr-only md:text-xs">Product</span>
          </ToggleGroupItem>
          <ToggleGroupItem value="visualization" aria-label="Visualization Lighting" title="Data Visualization Lighting">
            <LineChart className="h-4 w-4 mr-1" />
            <span className="sr-only md:not-sr-only md:text-xs">Visual</span>
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      
      <Separator className="my-1" />
      
      {/* Modify Controls */}
      <div>
        <div className="text-xs font-medium mb-1.5 text-muted-foreground">Modify</div>
        <div className="flex space-x-1">
          <Button variant="outline" size="sm" className="flex items-center justify-center h-9 w-9 p-0" title="Adjust Settings">
            <Sliders className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" className="flex items-center justify-center h-9 w-9 p-0" title="Reset View">
            <RotateCw className="h-4 w-4" />
          </Button>
        </div>
      </div>
      
      {/* Camera Controls */}
      <div>
        <div className="text-xs font-medium mb-1.5 text-muted-foreground">Camera</div>
        <div className="flex space-x-1">
          <Button variant="outline" size="sm" className="flex items-center justify-center h-9 w-9 p-0" title="Switch Camera">
            <Camera className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" className="flex items-center justify-center h-9 w-9 p-0" title="Toggle View Mode">
            <Eye className="h-4 w-4" />
          </Button>
        </div>
      </div>
      
      {/* Workspace Controls */}
      <div>
        <div className="text-xs font-medium mb-1.5 text-muted-foreground">Workspace</div>
        <div className="flex space-x-1">
          <Button variant="outline" size="sm" className="flex items-center justify-center h-9 w-9 p-0" title="Workspace Layout">
            <LayoutGrid className="h-4 w-4" />
          </Button>
        </div>
      </div>
      
      {/* Field of View Controls */}
      <div>
        <div className="text-xs font-medium mb-1.5 text-muted-foreground">Field of View</div>
        <div className="flex space-x-1">
          <Button variant="outline" size="sm" className="flex items-center justify-center h-9 w-9 p-0" title="Zoom Out">
            <ZoomOut className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" className="flex items-center justify-center h-9 w-9 p-0" title="Zoom In">
            <ZoomIn className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
};
