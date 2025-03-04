
import React, { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Video, VideoOff, Mic, MicOff, Settings } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import twitchService from '../services/TwitchService';

export const StreamControls = () => {
  const [isStreaming, setIsStreaming] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [streamTitle, setStreamTitle] = useState("My Stream");
  const [isMicEnabled, setIsMicEnabled] = useState(true);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [isConnectedToTwitch, setIsConnectedToTwitch] = useState(false);
  const [hasClientIdError, setHasClientIdError] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    setHasClientIdError(!import.meta.env.VITE_TWITCH_CLIENT_ID);
    
    const checkTwitchConnection = async () => {
      const isAuthenticated = twitchService.isAuthenticated();
      setIsConnectedToTwitch(isAuthenticated);
      
      if (isAuthenticated) {
        try {
          const streaming = await twitchService.isCurrentlyStreaming();
          setIsStreaming(streaming);
          if (streaming) {
            toast({
              title: "Stream status detected",
              description: "You are currently live on Twitch",
            });
          }
        } catch (error) {
          console.error("Error checking stream status:", error);
        }
      }
    };
    
    checkTwitchConnection();
    
    const handleAuthChange = () => {
      setIsConnectedToTwitch(twitchService.isAuthenticated());
    };
    
    window.addEventListener('twitch_auth_changed', handleAuthChange);
    
    return () => {
      window.removeEventListener('twitch_auth_changed', handleAuthChange);
    };
  }, [toast]);

  const toggleStream = async () => {
    if (isLoading) return;
    
    setIsLoading(true);
    
    try {
      if (isStreaming) {
        if (isConnectedToTwitch) {
          await twitchService.stopStream();
        }
        setIsStreaming(false);
        toast({
          title: "Stream ended",
          description: "Your stream has ended. Note: You need to also stop your broadcasting software.",
        });
      } else {
        if (hasClientIdError) {
          toast({
            title: "Twitch Configuration Error",
            description: "Twitch Client ID is missing. Please set VITE_TWITCH_CLIENT_ID in your environment variables.",
            variant: "destructive",
          });
          setIsLoading(false);
          return;
        }
        
        if (!isConnectedToTwitch) {
          toast({
            title: "Not connected to Twitch",
            description: "Please connect to Twitch in the settings below",
            variant: "destructive",
          });
          setIsLoading(false);
          return;
        }
        
        // Fix: Remove streamTitle argument since startStream doesn't accept parameters
        await twitchService.startStream();
        setIsStreaming(true);
        toast({
          title: "Stream started",
          description: "Your stream information has been updated. Start your broadcasting software to go live.",
        });
      }
    } catch (error) {
      console.error('Error toggling stream:', error);
      toast({
        title: "Error with stream",
        description: error instanceof Error ? error.message : "An error occurred while managing your stream",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
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
        disabled={hasClientIdError || isLoading || (!isConnectedToTwitch && !isStreaming)}
      >
        {isLoading ? "Processing..." : isStreaming ? "End Stream" : "Start Stream"}
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
