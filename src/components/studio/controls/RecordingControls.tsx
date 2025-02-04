import React from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Play, Square, Timer } from 'lucide-react';

export const RecordingControls = () => {
  return (
    <Card className="p-6">
      <h3 className="text-lg font-semibold mb-4">Recording Controls</h3>
      <div className="space-y-6">
        <div className="flex gap-2">
          <Button className="flex-1" variant="outline">
            <Play className="h-4 w-4 mr-2" />
            Start Recording
          </Button>
          <Button className="flex-1" variant="outline">
            <Square className="h-4 w-4 mr-2" />
            Stop
          </Button>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Label className="flex items-center gap-2">
              <Timer className="h-4 w-4" />
              Scheduled Recording
            </Label>
            <Switch />
          </div>
          
          <div className="flex items-center justify-between">
            <Label>Auto-Split Files</Label>
            <Switch />
          </div>
          
          <div className="flex items-center justify-between">
            <Label>Backup Recording</Label>
            <Switch />
          </div>
        </div>
      </div>
    </Card>
  );
};