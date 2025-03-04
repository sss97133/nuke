
import React, { useState } from 'react';
import { Card } from "@/components/ui/card";
import { StreamControls } from './controls/StreamControls';
import { StreamPreview } from './preview/StreamPreview';
import { StreamSettings } from './settings/StreamSettings';

export const StreamerView = () => {
  const [isLive, setIsLive] = useState(false);
  // Generate a unique stream ID when the component mounts
  const [streamId] = useState(`stream-${Math.random().toString(36).substring(2, 9)}`);

  return (
    <Card className="bg-card">
      <StreamPreview isLive={isLive} />
      <div className="p-4 space-y-4">
        <div className="flex gap-2 justify-end">
          <StreamControls />
        </div>
        <StreamSettings />
      </div>
    </Card>
  );
};
