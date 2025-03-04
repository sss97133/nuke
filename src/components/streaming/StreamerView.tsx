
import React, { useState, useEffect } from 'react';
import { Card } from "@/components/ui/card";
import { StreamControls } from './controls/StreamControls';
import { StreamPreview } from './preview/StreamPreview';
import { StreamSettings } from './settings/StreamSettings';
import { twitchService } from './services/TwitchService';
import { useToast } from "@/components/ui/use-toast";

export const StreamerView = () => {
  const [isLive, setIsLive] = useState(false);
  const [lastCheckTime, setLastCheckTime] = useState<Date | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    // Check initial streaming status
    const checkStreamStatus = async () => {
      if (twitchService.isAuthenticated()) {
        try {
          console.log("Checking Twitch stream status...");
          const streaming = await twitchService.isCurrentlyStreaming();
          console.log("Current stream status:", streaming ? "LIVE" : "OFFLINE");
          setIsLive(streaming);
          setLastCheckTime(new Date());
          
          if (streaming) {
            toast({
              title: "Stream status detected",
              description: "Your Twitch stream is currently live",
            });
          }
        } catch (error) {
          console.error("Error checking initial stream status:", error);
          toast({
            title: "Stream status check failed",
            description: error instanceof Error ? error.message : "Could not determine stream status",
            variant: "destructive",
          });
        }
      } else {
        console.log("Not authenticated with Twitch, skipping stream status check");
      }
    };
    
    checkStreamStatus();
    
    // Set up an interval to periodically check stream status
    const intervalId = setInterval(async () => {
      if (twitchService.isAuthenticated()) {
        try {
          const streaming = await twitchService.isCurrentlyStreaming();
          // Only update state if the status has changed
          if (streaming !== isLive) {
            console.log("Stream status changed to:", streaming ? "LIVE" : "OFFLINE");
            setIsLive(streaming);
            
            toast({
              title: streaming ? "Stream is now live" : "Stream has ended",
              description: streaming ? "Your Twitch stream is now live and visible to viewers" : "Your Twitch stream has ended",
            });
          }
          setLastCheckTime(new Date());
        } catch (error) {
          console.error("Error checking stream status:", error);
        }
      }
    }, 30000); // Check every 30 seconds
    
    return () => {
      clearInterval(intervalId);
    };
  }, [isLive, toast]);

  return (
    <Card className="bg-card">
      <StreamPreview isLive={isLive} />
      <div className="p-4 space-y-4">
        <div className="flex gap-2 justify-between items-center">
          <div className="text-xs text-muted-foreground">
            {lastCheckTime && (
              <>Last status check: {lastCheckTime.toLocaleTimeString()}</>
            )}
          </div>
          <StreamControls />
        </div>
        <StreamSettings />
      </div>
    </Card>
  );
};
