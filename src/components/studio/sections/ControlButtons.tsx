
import React from 'react';
import { Button } from '@/components/ui/button';
import { PlayCircle, PauseCircle, Film } from 'lucide-react';

interface ControlButtonsProps {
  isRecording: boolean;
  toggleRecording: () => void;
}

export const ControlButtons: React.FC<ControlButtonsProps> = ({ 
  isRecording,
  toggleRecording
}) => {
  return (
    <div className="flex justify-center space-x-4 mt-4">
      <Button
        variant={isRecording ? "destructive" : "default"}
        size="lg"
        className="gap-2"
        onClick={toggleRecording}
      >
        {isRecording ? (
          <>
            <PauseCircle className="h-5 w-5" />
            Stop Recording
          </>
        ) : (
          <>
            <PlayCircle className="h-5 w-5" />
            Start Recording
          </>
        )}
      </Button>
      
      <Button variant="outline" size="lg" className="gap-2">
        <Film className="h-5 w-5" />
        Take Snapshot
      </Button>
    </div>
  );
};
