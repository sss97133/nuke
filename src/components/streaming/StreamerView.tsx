
import React, { useState, useEffect } from 'react';
import { Card } from "@/components/ui/card";
import { StreamControls } from './controls/StreamControls';
import { StreamPreview } from './preview/StreamPreview';
import { StreamSettings } from './settings/StreamSettings';
import { twitchService } from './services/TwitchService';

export const StreamerView = () => {
  const [isLive, setIsLive] = useState(false);
  // Generate a unique stream ID when the component mounts
  const [streamId] = useState(`stream-${Math.random().toString(36).substring(2, 9)}`);

  useEffect(() => {
    // Check initial streaming status
    const checkStreamStatus = async () => {
      if (twitchService.isAuthenticated()) {
        try {
          const streaming = await twitchService.isCurrentlyStreaming();
          setIsLive(streaming);
        } catch (error) {
          console.error("Error checking initial stream status:", error);
        }
      }
    };
    
    checkStreamStatus();
    
    // Set up an interval to periodically check stream status
    const intervalId = setInterval(async () => {
      if (twitchService.isAuthenticated()) {
        try {
          const streaming = await twitchService.isCurrentlyStreaming();
          setIsLive(streaming);
        } catch (error) {
          console.error("Error checking stream status:", error);
        }
      }
    }, 30000); // Check every 30 seconds
    
    return () => {
      clearInterval(intervalId);
    };
  }, []);

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
