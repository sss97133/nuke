import React from 'react';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

export const StreamingControls = () => {
  return (
    <Card className="p-6">
      <h3 className="text-lg font-semibold mb-4">Streaming Settings</h3>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Label>YouTube</Label>
          <Switch />
        </div>
        <div className="flex items-center justify-between">
          <Label>Twitch</Label>
          <Switch />
        </div>
        <div className="flex items-center justify-between">
          <Label>Facebook Live</Label>
          <Switch />
        </div>
        <div className="flex items-center justify-between">
          <Label>Custom RTMP</Label>
          <Switch />
        </div>
      </div>
    </Card>
  );
};