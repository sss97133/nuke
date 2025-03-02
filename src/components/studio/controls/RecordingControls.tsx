
import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Mic, Square, FileVideo, Clock } from 'lucide-react';
import type { RecordingControlsProps } from '../types/componentTypes';

export const RecordingControls: React.FC<RecordingControlsProps> = ({ onStart, onStop }) => {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [quality, setQuality] = useState('1080p');
  const [timerId, setTimerId] = useState<number | null>(null);
  
  const handleStartRecording = () => {
    setIsRecording(true);
    setRecordingTime(0);
    
    if (onStart) onStart();
    
    // Start timer
    const timer = setInterval(() => {
      setRecordingTime(prev => prev + 1);
    }, 1000);
    
    // Store timer id for cleanup - converting to number for state
    setTimerId(Number(timer));
  };
  
  const handleStopRecording = () => {
    setIsRecording(false);
    if (onStop) onStop();
    
    // Clear timer
    if (timerId) {
      clearInterval(timerId);
      setTimerId(null);
    }
  };
  
  // Format seconds as MM:SS
  const formatTime = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
  };
  
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recording Controls</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isRecording && (
          <div className="flex items-center justify-center space-x-2 py-2 bg-red-500/10 rounded-md">
            <div className="animate-pulse h-3 w-3 bg-red-500 rounded-full"></div>
            <span className="text-red-500 font-medium">{formatTime(recordingTime)}</span>
          </div>
        )}
        
        <div className="space-y-2">
          <Label htmlFor="quality">Recording Quality</Label>
          <Select value={quality} onValueChange={setQuality} disabled={isRecording}>
            <SelectTrigger id="quality">
              <SelectValue placeholder="Select quality" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="720p">HD (720p)</SelectItem>
              <SelectItem value="1080p">Full HD (1080p)</SelectItem>
              <SelectItem value="4k">4K Ultra HD</SelectItem>
            </SelectContent>
          </Select>
        </div>
        
        <div className="grid grid-cols-2 gap-2 pt-2">
          {!isRecording ? (
            <Button 
              onClick={handleStartRecording}
              className="flex items-center gap-1 bg-red-500 text-white hover:bg-red-600"
            >
              <Mic className="h-4 w-4" />
              Start Recording
            </Button>
          ) : (
            <Button 
              onClick={handleStopRecording}
              variant="outline"
              className="flex items-center gap-1"
            >
              <Square className="h-4 w-4" />
              Stop Recording
            </Button>
          )}
          
          <Button 
            variant="outline" 
            className="flex items-center gap-1"
            disabled={isRecording}
          >
            <FileVideo className="h-4 w-4" />
            Recordings
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
