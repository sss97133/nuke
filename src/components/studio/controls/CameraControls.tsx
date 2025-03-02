
import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Camera, RefreshCw, ZoomIn } from 'lucide-react';
import type { CameraControlsProps } from '../types/componentTypes';

export const CameraControls: React.FC<CameraControlsProps> = ({ }) => {
  const [cameraSource, setCameraSource] = React.useState('integrated');
  const [resolution, setResolution] = React.useState('1080p');
  
  return (
    <Card>
      <CardHeader>
        <CardTitle>Camera Settings</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="camera-source">Camera Source</Label>
          <Select value={cameraSource} onValueChange={setCameraSource}>
            <SelectTrigger id="camera-source">
              <SelectValue placeholder="Select camera" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="integrated">Integrated Camera</SelectItem>
              <SelectItem value="external">External Camera</SelectItem>
              <SelectItem value="dslr">DSLR via Capture Card</SelectItem>
              <SelectItem value="phone">Phone Camera</SelectItem>
            </SelectContent>
          </Select>
        </div>
        
        <div className="space-y-2">
          <Label htmlFor="resolution">Resolution</Label>
          <Select value={resolution} onValueChange={setResolution}>
            <SelectTrigger id="resolution">
              <SelectValue placeholder="Select resolution" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="720p">HD (720p)</SelectItem>
              <SelectItem value="1080p">Full HD (1080p)</SelectItem>
              <SelectItem value="4k">4K Ultra HD</SelectItem>
            </SelectContent>
          </Select>
        </div>
        
        <div className="flex space-x-2">
          <Button variant="outline" className="flex-1 flex items-center gap-1">
            <Camera className="h-4 w-4" />
            Test Camera
          </Button>
          <Button variant="outline" className="flex-1 flex items-center gap-1">
            <RefreshCw className="h-4 w-4" />
            Reset
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
