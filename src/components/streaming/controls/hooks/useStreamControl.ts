
import { useState, useEffect } from 'react';
import { useToast } from "@/components/ui/use-toast";
import twitchService from '../../services/TwitchService';

export const useStreamControl = () => {
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

  return {
    isLive,
    isLoading,
    username,
    handleStartStream,
    handleStopStream
  };
};
