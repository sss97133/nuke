
import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PlayCircle, PauseCircle, Link, Share, Youtube, Twitch } from 'lucide-react';
import type { StreamingControlsProps } from '../types/componentTypes';

export const StreamingControls: React.FC<StreamingControlsProps> = ({ onStart, onStop }) => {
  const [isStreaming, setIsStreaming] = useState(false);
  
  const handleToggleStreaming = () => {
    if (isStreaming) {
      onStop();
    } else {
      onStart();
    }
    setIsStreaming(!isStreaming);
  };
  
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Platform</Label>
        <Select defaultValue="youtube">
          <SelectTrigger>
            <SelectValue placeholder="Select platform" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="youtube">
              <div className="flex items-center">
                <Youtube className="h-4 w-4 mr-2" /> YouTube
              </div>
            </SelectItem>
            <SelectItem value="twitch">
              <div className="flex items-center">
                <Twitch className="h-4 w-4 mr-2" /> Twitch
              </div>
            </SelectItem>
            <SelectItem value="custom">Custom RTMP</SelectItem>
          </SelectContent>
        </Select>
      </div>
      
      <div className="space-y-2">
        <Label>Stream Key</Label>
        <Input type="password" placeholder="Enter your stream key" />
      </div>
      
      <div className="space-y-2">
        <Label>Quality</Label>
        <Select defaultValue="720p">
          <SelectTrigger>
            <SelectValue placeholder="Select quality" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="720p">720p</SelectItem>
            <SelectItem value="1080p">1080p</SelectItem>
          </SelectContent>
        </Select>
      </div>
      
      <div className="flex mt-4">
        <Button
          variant={isStreaming ? "destructive" : "default"}
          size="sm"
          className="flex-1"
          onClick={handleToggleStreaming}
        >
          {isStreaming ? (
            <>
              <PauseCircle className="h-4 w-4 mr-2" />
              End Stream
            </>
          ) : (
            <>
              <PlayCircle className="h-4 w-4 mr-2" />
              Go Live
            </>
          )}
        </Button>
      </div>
      
      <Button variant="outline" size="sm" className="w-full" disabled={!isStreaming}>
        <Share className="h-4 w-4 mr-2" />
        Share Stream
      </Button>
    </div>
  );
};
