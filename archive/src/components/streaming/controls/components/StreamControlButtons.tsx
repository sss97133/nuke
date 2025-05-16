
import React from 'react';
import { Button } from "@/components/ui/button";
import { PlayCircle, StopCircle } from "lucide-react";

interface StreamControlButtonsProps {
  isLive: boolean;
  isLoading: boolean;
  onStartStream: () => void;
  onStopStream: () => void;
}

export const StreamControlButtons: React.FC<StreamControlButtonsProps> = ({
  isLive,
  isLoading,
  onStartStream,
  onStopStream
}) => {
  return (
    <>
      {isLive ? (
        <Button 
          variant="destructive" 
          onClick={onStopStream}
          disabled={isLoading}
        >
          <StopCircle className="mr-2 h-4 w-4" />
          {isLoading ? "Stopping..." : "Stop Stream"}
        </Button>
      ) : (
        <Button 
          variant="default" 
          onClick={onStartStream}
          disabled={isLoading}
        >
          <PlayCircle className="mr-2 h-4 w-4" />
          {isLoading ? "Starting..." : "Start Stream"}
        </Button>
      )}
    </>
  );
};
