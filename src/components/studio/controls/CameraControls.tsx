import React from 'react';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

export const CameraControls = () => {
  return (
    <Card className="p-6">
      <h3 className="text-lg font-semibold mb-4">Camera Controls</h3>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Label>Auto Focus</Label>
          <Switch />
        </div>
        <div className="flex items-center justify-between">
          <Label>Auto Exposure</Label>
          <Switch />
        </div>
        <div className="flex items-center justify-between">
          <Label>White Balance</Label>
          <Switch />
        </div>
      </div>
    </Card>
  );
};