
import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Wifi, WifiOff, Share2, Users } from 'lucide-react';
import type { StreamingControlsProps } from '../types/componentTypes';

export const StreamingControls: React.FC<StreamingControlsProps> = ({ onStart, onStop }) => {
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamTitle, setStreamTitle] = useState('Studio Session');
  const [viewerCount, setViewerCount] = useState(0);
  const [streamTime, setStreamTime] = useState(0);
  
  const handleStartStreaming = () => {
    setIsStreaming(true);
    setStreamTime(0);
    setViewerCount(Math.floor(Math.random() * 25)); // Simulate viewers
    
    if (onStart) onStart();
    
    // Start timer
    const timer = setInterval(() => {
      setStreamTime(prev => prev + 1);
      
      // Randomly update viewer count
      if (Math.random() > 0.7) {
        setViewerCount(prev => {
          const change = Math.floor(Math.random() * 5) - 2;
          return Math.max(0, prev + change);
        });
      }
    }, 1000);
    
    // Store timer id for cleanup
    setTimerId(timer);
  };
  
  const handleStopStreaming = () => {
    setIsStreaming(false);
    if (onStop) onStop();
    
    // Clear timer
    if (timerId) {
      clearInterval(timerId);
      setTimerId(null);
    }
  };
  
  const [timerId, setTimerId] = useState<number | null>(null);
  
  // Format seconds as HH:MM:SS
  const formatTime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
  };
  
  return (
    <Card>
      <CardHeader>
        <CardTitle>Streaming Controls</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isStreaming && (
          <div className="flex flex-col items-center justify-center space-y-2 py-2 bg-green-500/10 rounded-md">
            <div className="flex items-center space-x-2">
              <div className="animate-pulse h-3 w-3 bg-green-500 rounded-full"></div>
              <span className="text-green-500 font-medium">LIVE: {formatTime(streamTime)}</span>
            </div>
            <div className="flex items-center space-x-1 text-sm">
              <Users className="h-3 w-3" />
              <span>{viewerCount} viewers</span>
            </div>
          </div>
        )}
        
        <div className="space-y-2">
          <Label htmlFor="stream-title">Stream Title</Label>
          <Input 
            id="stream-title"
            value={streamTitle}
            onChange={(e) => setStreamTitle(e.target.value)}
            disabled={isStreaming}
          />
        </div>
        
        <div className="grid grid-cols-2 gap-2 pt-2">
          {!isStreaming ? (
            <Button 
              onClick={handleStartStreaming}
              className="flex items-center gap-1 bg-green-500 text-white hover:bg-green-600"
            >
              <Wifi className="h-4 w-4" />
              Go Live
            </Button>
          ) : (
            <Button 
              onClick={handleStopStreaming}
              variant="outline"
              className="flex items-center gap-1 border-red-500 text-red-500"
            >
              <WifiOff className="h-4 w-4" />
              End Stream
            </Button>
          )}
          
          <Button 
            variant="outline" 
            className="flex items-center gap-1"
          >
            <Share2 className="h-4 w-4" />
            Share Stream
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
