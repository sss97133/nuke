import React from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';

interface ControlButtonsProps {
  isRecording: boolean;
  isStreaming: boolean;
  onRecordingToggle: () => void;
  onStreamingToggle: () => void;
}

export const ControlButtons = ({
  isRecording,
  isStreaming,
  onRecordingToggle,
  onStreamingToggle,
}: ControlButtonsProps) => {
  return (
    <div className="flex gap-4 mb-6">
      <Button 
        variant={isRecording ? "destructive" : "default"}
        onClick={onRecordingToggle}
        className="w-32"
      >
        {isRecording ? "Stop Recording" : "Start Recording"}
      </Button>
      <Button 
        variant={isStreaming ? "destructive" : "default"}
        onClick={onStreamingToggle}
        className="w-32"
      >
        {isStreaming ? "End Stream" : "Go Live"}
      </Button>
    </div>
  );
};