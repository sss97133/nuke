
import React from 'react';
import { Button } from '@/components/ui/button';
import { 
  Camera,
  Eye, 
  ZoomIn, 
  ZoomOut, 
  LayoutGrid,
  BarChart3
} from 'lucide-react';

interface LightingControlsProps {
  lightMode: 'basic' | 'product' | 'visualization';
  onLightModeChange: (mode: 'basic' | 'product' | 'visualization') => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onToggleLayout: () => void;
}

export const LightingControls: React.FC<LightingControlsProps> = ({
  lightMode,
  onLightModeChange,
  onZoomIn,
  onZoomOut,
  onToggleLayout
}) => {
  return (
    <div className="bg-background/80 backdrop-blur-sm p-5 rounded-lg shadow-md h-full flex flex-col">
      {/* Light Mode Section */}
      <div className="mb-8">
        <h3 className="text-base font-medium mb-4 text-muted-foreground">Lighting Mode</h3>
        <div className="grid grid-cols-2 gap-3">
          <Button 
            variant={lightMode === 'basic' ? "default" : "outline"} 
            size="lg" 
            className="h-16 w-full flex flex-col items-center justify-center" 
            onClick={() => onLightModeChange('basic')}
          >
            <Camera className="h-5 w-5 mb-1" />
            <span className="text-xs">Basic</span>
          </Button>
          
          <Button 
            variant={lightMode === 'product' ? "default" : "outline"} 
            size="lg" 
            className="h-16 w-full flex flex-col items-center justify-center" 
            onClick={() => onLightModeChange('product')}
          >
            <Eye className="h-5 w-5 mb-1" />
            <span className="text-xs">Product</span>
          </Button>
          
          <Button 
            variant={lightMode === 'visualization' ? "default" : "outline"} 
            size="lg" 
            className="h-16 w-full flex flex-col items-center justify-center col-span-2" 
            onClick={() => onLightModeChange('visualization')}
          >
            <BarChart3 className="h-5 w-5 mb-1" />
            <span className="text-xs">Visualization</span>
          </Button>
        </div>
      </div>

      {/* Workspace Section */}
      <div className="mb-8">
        <h3 className="text-base font-medium mb-4 text-muted-foreground">Workspace</h3>
        <Button 
          variant="outline" 
          size="lg" 
          className="h-16 w-full flex flex-col items-center justify-center" 
          onClick={onToggleLayout}
        >
          <LayoutGrid className="h-5 w-5 mb-1" />
          <span className="text-xs">Toggle Layout</span>
        </Button>
      </div>
      
      {/* Field of View Section */}
      <div className="mb-8">
        <h3 className="text-base font-medium mb-4 text-muted-foreground">Field of View</h3>
        <div className="grid grid-cols-2 gap-3">
          <Button 
            variant="outline" 
            size="lg" 
            className="h-16 w-full flex flex-col items-center justify-center" 
            onClick={onZoomOut}
          >
            <ZoomOut className="h-5 w-5 mb-1" />
            <span className="text-xs">Zoom Out</span>
          </Button>
          <Button 
            variant="outline" 
            size="lg" 
            className="h-16 w-full flex flex-col items-center justify-center" 
            onClick={onZoomIn}
          >
            <ZoomIn className="h-5 w-5 mb-1" />
            <span className="text-xs">Zoom In</span>
          </Button>
        </div>
      </div>
    </div>
  );
};
