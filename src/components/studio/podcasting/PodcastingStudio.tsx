import React, { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Mic2, Radio, Settings } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { AudioControls } from '../controls/AudioControls';

export const PodcastingStudio = () => {
  const [isRecording, setIsRecording] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const [episodeTitle, setEpisodeTitle] = useState('');
  const [audioLevel, setAudioLevel] = useState([50]);
  const { toast } = useToast();

  const handleRecordingToggle = () => {
    setIsRecording(!isRecording);
    toast({
      title: isRecording ? "Recording Stopped" : "Recording Started",
      description: isRecording ? "Your episode has been saved" : "Recording new episode",
    });
  };

  const handleLiveToggle = () => {
    setIsLive(!isLive);
    toast({
      title: isLive ? "Stream Ended" : "Stream Started",
      description: isLive ? "Your live session has ended" : "Going live on configured platforms",
    });
  };

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <h3 className="text-lg font-semibold mb-4">Podcast Studio</h3>
        
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Episode Title</Label>
            <Input 
              value={episodeTitle}
              onChange={(e) => setEpisodeTitle(e.target.value)}
              placeholder="Enter episode title..."
            />
          </div>

          <AudioControls 
            audioLevel={audioLevel}
            setAudioLevel={setAudioLevel}
          />

          <div className="flex gap-4">
            <Button 
              variant={isRecording ? "destructive" : "default"}
              onClick={handleRecordingToggle}
              className="flex items-center gap-2"
            >
              <Mic2 className="w-4 h-4" />
              {isRecording ? "Stop Recording" : "Start Recording"}
            </Button>

            <Button 
              variant={isLive ? "destructive" : "default"}
              onClick={handleLiveToggle}
              className="flex items-center gap-2"
            >
              <Radio className="w-4 h-4" />
              {isLive ? "End Stream" : "Go Live"}
            </Button>

            <Button variant="outline" className="flex items-center gap-2">
              <Settings className="w-4 h-4" />
              Settings
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
};