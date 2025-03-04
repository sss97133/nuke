
import React, { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Video, VideoOff, Mic, MicOff, Settings } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { twitchService } from '../services/TwitchService';

export const StreamControls = () => {
  const [isStreaming, setIsStreaming] = useState(false);
  const [isMicEnabled, setIsMicEnabled] = useState(true);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [isConnectedToTwitch, setIsConnectedToTwitch] = useState(false);
  const [hasClientIdError, setHasClientIdError] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    // Check if Twitch Client ID is missing
    setHasClientIdError(!import.meta.env.VITE_TWITCH_CLIENT_ID);
    
    // Check if we're already authenticated with Twitch
    setIsConnectedToTwitch(twitchService.isAuthenticated());
    
    // Listen for authentication state changes
    const handleAuthChange = () => {
      setIsConnectedToTwitch(twitchService.isAuthenticated());
    };
    
    window.addEventListener('twitch_auth_changed', handleAuthChange);
    
    // Clean up the event listener on unmount
    return () => {
      window.removeEventListener('twitch_auth_changed', handleAuthChange);
    };
  }, []);

  const toggleStream = async () => {
    if (isStreaming) {
      // Stop streaming
      try {
        if (isConnectedToTwitch) {
          await twitchService.stopStream();
        }
        setIsStreaming(false);
        toast({
          title: "Stream ended",
          description: "Your stream has ended",
        });
      } catch (error) {
        console.error('Error stopping stream:', error);
        toast({
          title: "Error stopping stream",
          description: "An error occurred while stopping the stream",
          variant: "destructive",
        });
      }
    } else {
      // Start streaming
      try {
        if (hasClientIdError) {
          toast({
            title: "Twitch Configuration Error",
            description: "Twitch Client ID is missing. Please set VITE_TWITCH_CLIENT_ID in your environment variables.",
            variant: "destructive",
          });
          return;
        }
        
        if (isConnectedToTwitch) {
          await twitchService.startStream("My Stream");
        }
        setIsStreaming(true);
        toast({
          title: "Stream started",
          description: "You are now live!",
        });
      } catch (error) {
        console.error('Error starting stream:', error);
        if (!isConnectedToTwitch) {
          toast({
            title: "Not connected to Twitch",
            description: "Please connect to Twitch in the settings below",
            variant: "destructive",
          });
        } else {
          toast({
            title: "Error starting stream",
            description: error instanceof Error ? error.message : "An error occurred while starting the stream",
            variant: "destructive",
          });
        }
      }
    }
  };

  const toggleMic = () => {
    setIsMicEnabled(!isMicEnabled);
    toast({
      title: isMicEnabled ? "Mic disabled" : "Mic enabled",
      description: isMicEnabled ? "Your microphone is now off" : "Your microphone is now on",
    });
  };

  const toggleVideo = () => {
    setIsVideoEnabled(!isVideoEnabled);
    toast({
      title: isVideoEnabled ? "Video disabled" : "Video enabled",
      description: isVideoEnabled ? "Your camera is now off" : "Your camera is now on",
    });
  };

  return (
    <div className="flex gap-2">
      <Button 
        variant={isStreaming ? "destructive" : "default"}
        onClick={toggleStream}
        disabled={hasClientIdError && !isStreaming}
      >
        {isStreaming ? "End Stream" : "Start Stream"}
      </Button>
      
      <Button 
        variant="outline" 
        size="icon"
        onClick={toggleMic}
      >
        {isMicEnabled ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
      </Button>
      
      <Button 
        variant="outline" 
        size="icon"
        onClick={toggleVideo}
      >
        {isVideoEnabled ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}
      </Button>
      
      <Button 
        variant="outline" 
        size="icon"
      >
        <Settings className="h-4 w-4" />
      </Button>
    </div>
  );
};
