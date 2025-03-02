
import React from 'react';
import { Button } from '@/components/ui/button';
import { 
  Camera,
  Eye, 
  ZoomIn, 
  ZoomOut, 
  LayoutGrid,
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
    <div className="bg-background/80 backdrop-blur-sm p-5 rounded-lg shadow-md">
      {/* Light Mode Buttons */}
      <div className="flex space-x-2 mb-4">
        <Button 
          variant={lightMode === 'basic' ? "default" : "outline"} 
          size="sm" 
          className="h-14 w-14 p-0" 
          onClick={() => onLightModeChange('basic')}
          title="Basic Lighting"
        >
          <Camera className="h-6 w-6" />
        </Button>
        
        <Button 
          variant={lightMode === 'product' ? "default" : "outline"} 
          size="sm" 
          className="h-14 w-14 p-0" 
          onClick={() => onLightModeChange('product')}
          title="Product Lighting"
        >
          <Eye className="h-6 w-6" />
        </Button>
      </div>

      {/* Workspace Section */}
      <div className="mb-6">
        <h3 className="text-base font-medium mb-3 text-muted-foreground">Workspace</h3>
        <Button 
          variant="outline" 
          size="sm" 
          className="h-14 w-14 p-0" 
          title="Toggle Layout"
          onClick={onToggleLayout}
        >
          <LayoutGrid className="h-6 w-6" />
        </Button>
      </div>
      
      {/* Field of View Section */}
      <div>
        <h3 className="text-base font-medium mb-3 text-muted-foreground">Field of View</h3>
        <div className="flex space-x-2">
          <Button 
            variant="outline" 
            size="sm" 
            className="h-14 w-14 p-0" 
            title="Zoom Out"
            onClick={onZoomOut}
          >
            <ZoomOut className="h-6 w-6" />
          </Button>
          <Button 
            variant="outline" 
            size="sm" 
            className="h-14 w-14 p-0" 
            title="Zoom In"
            onClick={onZoomIn}
          >
            <ZoomIn className="h-6 w-6" />
          </Button>
        </div>
      </div>
    </div>
  );
};
