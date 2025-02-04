import React from 'react';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

interface CameraConfigProps {
  cameras: {
    frontWall: boolean;
    backWall: boolean;
    leftWall: boolean;
    rightWall: boolean;
    ceiling: boolean;
    showCone: boolean;
  };
  onCameraChange: (key: string, value: boolean) => void;
}

export const CameraConfigSection = ({ cameras, onCameraChange }: CameraConfigProps) => {
  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="flex items-center justify-between">
        <Label htmlFor="frontWall">Front Wall Camera</Label>
        <Switch
          id="frontWall"
          checked={cameras.frontWall}
          onCheckedChange={(checked) => onCameraChange('frontWall', checked)}
        />
      </div>
      <div className="flex items-center justify-between">
        <Label htmlFor="backWall">Back Wall Camera</Label>
        <Switch
          id="backWall"
          checked={cameras.backWall}
          onCheckedChange={(checked) => onCameraChange('backWall', checked)}
        />
      </div>
      <div className="flex items-center justify-between">
        <Label htmlFor="leftWall">Left Wall Camera</Label>
        <Switch
          id="leftWall"
          checked={cameras.leftWall}
          onCheckedChange={(checked) => onCameraChange('leftWall', checked)}
        />
      </div>
      <div className="flex items-center justify-between">
        <Label htmlFor="rightWall">Right Wall Camera</Label>
        <Switch
          id="rightWall"
          checked={cameras.rightWall}
          onCheckedChange={(checked) => onCameraChange('rightWall', checked)}
        />
      </div>
      <div className="flex items-center justify-between">
        <Label htmlFor="ceiling">Ceiling Camera</Label>
        <Switch
          id="ceiling"
          checked={cameras.ceiling}
          onCheckedChange={(checked) => onCameraChange('ceiling', checked)}
        />
      </div>
      <div className="flex items-center justify-between">
        <Label htmlFor="showCone">Show Camera Cones</Label>
        <Switch
          id="showCone"
          checked={cameras.showCone}
          onCheckedChange={(checked) => onCameraChange('showCone', checked)}
        />
      </div>
    </div>
  );
};