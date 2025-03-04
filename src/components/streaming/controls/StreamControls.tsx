
import React, { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Video, VideoOff, Mic, MicOff, Settings } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";

export const StreamControls = () => {
  const [isStreaming, setIsStreaming] = useState(false);
  const [isMicEnabled, setIsMicEnabled] = useState(true);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const { toast } = useToast();

  const toggleStream = () => {
    setIsStreaming(!isStreaming);
    toast({
      title: isStreaming ? "Stream ended" : "Stream started",
      description: isStreaming ? "Your stream has ended" : "You are now live!",
    });
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
