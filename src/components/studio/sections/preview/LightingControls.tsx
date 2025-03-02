
import React from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { ZoomIn, ZoomOut, RefreshCw, Sun, Lightbulb } from "lucide-react";

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
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Scene Controls</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex justify-around">
            <Button size="sm" variant="outline" onClick={onZoomIn}>
              <ZoomIn className="h-4 w-4 mr-1" />
              Zoom In
            </Button>
            <Button size="sm" variant="outline" onClick={onZoomOut}>
              <ZoomOut className="h-4 w-4 mr-1" />
              Zoom Out
            </Button>
            <Button size="sm" variant="outline" onClick={onToggleLayout}>
              <RefreshCw className="h-4 w-4 mr-1" />
              Layout
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Lighting Mode</CardTitle>
        </CardHeader>
        <CardContent>
          <RadioGroup
            value={lightMode}
            onValueChange={(value) => onLightModeChange(value as 'basic' | 'product' | 'visualization')}
            className="space-y-2"
          >
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="basic" id="basic" />
              <Label htmlFor="basic" className="flex items-center">
                <Sun className="h-4 w-4 mr-2" />
                Basic
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="product" id="product" />
              <Label htmlFor="product" className="flex items-center">
                <Lightbulb className="h-4 w-4 mr-2" />
                Product
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="visualization" id="visualization" />
              <Label htmlFor="visualization" className="flex items-center">
                <RefreshCw className="h-4 w-4 mr-2" />
                Visualization
              </Label>
            </div>
          </RadioGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Light Intensity</CardTitle>
        </CardHeader>
        <CardContent>
          <Slider
            defaultValue={[75]}
            max={100}
            step={1}
            className="py-4"
          />
        </CardContent>
      </Card>
    </div>
  );
};
