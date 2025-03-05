
import React, { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { PlayCircle, StopCircle, Share2 } from "lucide-react";
import twitchService from '../services/TwitchService';
import { useToast } from "@/components/ui/use-toast";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ShareableLink } from '../settings/components/ShareableLink';

export const StreamControls = () => {
  const [isLive, setIsLive] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [username, setUsername] = useState<string>('');
  const { toast } = useToast();

  useEffect(() => {
    const checkStreamStatus = async () => {
      if (twitchService.isAuthenticated()) {
        try {
          const streaming = await twitchService.isCurrentlyStreaming();
          setIsLive(streaming);
          
          // Get username for shareable link
          const userData = await twitchService.getCurrentUser();
          if (userData) {
            setUsername(userData.login);
          }
        } catch (error) {
          console.error("Error checking stream status:", error);
        }
      }
    };
    
    checkStreamStatus();
  }, []);

  const handleStartStream = async () => {
    if (!twitchService.isAuthenticated()) {
      toast({
        title: "Authentication Required",
        description: "Please connect your Twitch account first",
        variant: "destructive",
      });
      return;
    }
    
    setIsLoading(true);
    try {
      // Default values, in a real app these would come from a form
      const result = await twitchService.startStream("Live Stream from App", "Just Chatting");
      
      if (result) {
        setIsLive(true);
        toast({
          title: "Stream Started",
          description: "Your Twitch stream has been started successfully",
        });
      }
    } catch (error) {
      console.error("Error starting stream:", error);
      toast({
        title: "Failed to Start Stream",
        description: error instanceof Error ? error.message : "An unknown error occurred",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleStopStream = async () => {
    setIsLoading(true);
    try {
      const result = await twitchService.stopStream();
      
      if (result) {
        setIsLive(false);
        toast({
          title: "Stream Stopped",
          description: "Your Twitch stream has been stopped",
        });
      }
    } catch (error) {
      console.error("Error stopping stream:", error);
      toast({
        title: "Failed to Stop Stream",
        description: error instanceof Error ? error.message : "An unknown error occurred",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex space-x-2">
      {isLive ? (
        <Button 
          variant="destructive" 
          onClick={handleStopStream}
          disabled={isLoading}
        >
          <StopCircle className="mr-2 h-4 w-4" />
          {isLoading ? "Stopping..." : "Stop Stream"}
        </Button>
      ) : (
        <Button 
          variant="default" 
          onClick={handleStartStream}
          disabled={isLoading}
        >
          <PlayCircle className="mr-2 h-4 w-4" />
          {isLoading ? "Starting..." : "Start Stream"}
        </Button>
      )}
      
      {username && (
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline">
              <Share2 className="mr-2 h-4 w-4" />
              Share Link
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto">
            <ShareableLink username={username} />
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
};
